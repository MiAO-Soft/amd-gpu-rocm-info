import GLib from "gi://GLib";
import St from "gi://St";
import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import Gio from "gi://Gio";

import {
  Extension,
  gettext as _,
} from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";

const GPU_MONITOR_REFRESH_INTERVAL = 1000; // 1 seconds

const GPUMonitorIndicator = GObject.registerClass(
  class GPUMonitorIndicator extends PanelMenu.Button {
    _init() {
      super._init(0.0, "AMD GPU Monitor");

      this._container = new St.BoxLayout({
        style_class: "gpu-monitor-container",
        vertical: false,
      });

      // Create labels for each metric
      this._powerLabel = new St.Label({
        text: "--- W (0%)",
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "gpu-monitor-label",
      });
      this._tempLabel = new St.Label({
        text: "---°C",
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "gpu-monitor-label",
      });
      this._memLabel = new St.Label({
        text: "-/- GB",
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "gpu-monitor-label",
      });

      // Add labels to container with icons
      this._addMetricWithIcon(
        "network-transmit-receive-symbolic",
        this._powerLabel
      );
      this._addMetricWithIcon(
        "power-profile-power-saver-symbolic-rtl",
        this._tempLabel
      );
      this._addMetricWithIcon(
        "network-cellular-signal-good-symbolic",
        this._memLabel
      );

      this.add_child(this._container);

      // Initialize timeout source
      this._timeout = null;

      // Connect to screen lock/unlock signals
      if (Main.screenShield !== null) {
        this._screenLockedId = Main.screenShield.connect('lock-screen', () => this._onLockScreen());
        this._screenUnlockedId = Main.screenShield.connect('unlock-screen', () => this._onUnlockScreen());
      }

      this._startMonitoring();
    }

    _startMonitoring() {
      // Stop any existing timeout
      if (this._timeout) {
        GLib.source_remove(this._timeout);
        this._timeout = null;
      }

      // Initial update
      this._updateGPUInfo();

      // Start periodic updates
      this._timeout = GLib.timeout_add_seconds(
        GLib.PRIORITY_DEFAULT,
        GPU_MONITOR_REFRESH_INTERVAL / 1000,
        () => {
          this._updateGPUInfo();
          return GLib.SOURCE_CONTINUE;
        }
      );
    }

    _onLockScreen() {
      // Clean up when screen is locked
      if (this._timeout) {
        GLib.source_remove(this._timeout);
        this._timeout = null;
      }
    }

    _onUnlockScreen() {
      // Restart monitoring when screen is unlocked
      this._startMonitoring();
    }

    _addMetricWithIcon(iconName, label) {
      const icon = new St.Icon({
        icon_name: iconName,
        style_class: "system-status-icon",
      });

      const box = new St.BoxLayout({vertical: false});
      box.add_child(icon);
      box.add_child(label);
      this._container.add_child(box);
    }

    _updateGPUInfo() {
      // Helper function to run a command asynchronously
      const runCommand = (args, callback) => {
        try {
          let subprocess = new Gio.Subprocess({
            argv: args,
            flags:
              Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
          });
          subprocess.init(null);

          subprocess.communicate_utf8_async(null, null, (proc, res) => {
            try {
              let [, stdout, stderr] = proc.communicate_utf8_finish(res);
              if (proc.get_successful()) {
                callback(stdout);
              } else {
                console.error(
                  `Command failed: ${args.join(" ")}, Error: ${stderr}`
                );
              }
            } catch (e) {
              console.error(`Error running command ${args.join(" ")}:`, e);
            }
          });
        } catch (e) {
          console.error(`Error creating subprocess:`, e);
        }
      };

      // Get TDP
      runCommand(["sudo", "ryzenadj", "-i", "--json"], (stdout) => {
        let allData = JSON.parse(stdout);
        if (!("error" in allData)) {
          let stapmLimit = parseInt(allData["STAPM LIMIT"]);
          let stapmValue = parseInt(allData["STAPM VALUE"]);

          this._powerLabel.set_text(`${stapmValue}W/${stapmLimit}W`);
        }
      });

      // Get GPU frequency
      runCommand(["rocm-smi", "-a", "--showmeminfo", "vram", "--json"], (stdout) => {
        let allData = JSON.parse(stdout);
        if ("card0" in allData) {
          let cardData = allData["card0"];
          // let power = parseInt(cardData["Current Socket Graphics Package Power (W)"]);
          let temp = parseInt(cardData["Temperature (Sensor edge) (C)"]);
          let gpuuse = cardData["GPU use (%)"];
          let vramall = this._formatBytes(parseInt(cardData["VRAM Total Memory (B)"]));
          let vramuse = this._formatBytes(parseInt(cardData["VRAM Total Used Memory (B)"]));

          // this._powerLabel.set_text(`${power}W (${gpuuse}%)`);

          this._tempLabel.set_text(`${temp}°C (${gpuuse}%)`);
          // Change color based on temperature
          if (temp > 85) {
            this._tempLabel.style_class = "gpu-monitor-label temp-high";
          } else if (temp > 70) {
            this._tempLabel.style_class = "gpu-monitor-label temp-warm";
          } else {
            this._tempLabel.style_class = "gpu-monitor-label temp-normal";
          }

          this._memLabel.set_text(`${vramuse} / ${vramall}`);
        }
      });
      return true;
    }

    _formatBytes(bytes) {
      if (bytes === 0 || isNaN(bytes)) return "0 B";

      const k = 1024;
      const sizes = ["B", "KB", "MB", "GB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));

      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
    }

    destroy() {
      // Disconnect signals
      if (this._screenLockedId) {
        Main.screenShield.disconnect(this._screenLockedId);
        this._screenLockedId = null;
      }
      if (this._screenUnlockedId) {
        Main.screenShield.disconnect(this._screenUnlockedId);
        this._screenUnlockedId = null;
      }

      // Remove timeout
      if (this._timeout) {
        GLib.source_remove(this._timeout);
        this._timeout = null;
      }

      super.destroy();
    }
  }
);

export default class AmdGpuMonitorExtension extends Extension {
  enable() {
    this._indicator = new GPUMonitorIndicator();
    Main.panel.addToStatusArea(this.uuid, this._indicator, 1, "left");
  }

  disable() {
    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }
  }
}