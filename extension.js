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

const GPU_MONITOR_REFRESH_INTERVAL = 3000; // 3 seconds

const GPUMonitorIndicator = GObject.registerClass(
  class GPUMonitorIndicator extends PanelMenu.Button {
    _init() {
      super._init(0.0, "AMD GPU Monitor");

      this._container = new St.BoxLayout({
        style_class: "gpu-monitor-container",
        vertical: false,
      });

      // Create labels for each metric
      this._freqLabel = new St.Label({
        text: "--- MHz",
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "gpu-monitor-label",
      });
      this._tempLabel = new St.Label({
        text: "---°C",
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "gpu-monitor-label",
      });
      this._memLabel = new St.Label({
        text: "--- MB",
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "gpu-monitor-label",
      });

      // Add labels to container with icons
      this._addMetricWithIcon(
        "network-transmit-receive-symbolic",
        this._freqLabel
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
      this._updateGPUInfo();
      this._timeout = GLib.timeout_add_seconds(
        GLib.PRIORITY_DEFAULT,
        GPU_MONITOR_REFRESH_INTERVAL / 1000,
        () => {
          this._updateGPUInfo();
          return GLib.SOURCE_CONTINUE;
        }
      );
    }

    _addMetricWithIcon(iconName, label) {
      const icon = new St.Icon({
        icon_name: iconName,
        style_class: "system-status-icon",
      });

      const box = new St.BoxLayout({ vertical: false });
      box.add_child(icon);
      box.add_child(label);
      this._container.add_child(box);
    }

    _updateGPUInfo() {
      // Helper function to run a command asynchronously
      const runCommand = (args, callback) => {
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
      };

      // Get GPU frequency
      runCommand(["rocm-smi", "--showclocks"], (stdout) => {
        let freqMatch = stdout.match(/.*sclk.*\((\d+).*/i);
        if (freqMatch) {
          this._freqLabel.set_text(`${freqMatch[1]} MHz`);
        }
      });

      // Get GPU temperature
      runCommand(["rocm-smi", "--showtemp"], (stdout) => {
        let tempMatch = stdout.match(/.*jun.*: ([\d|\.]+).*/i);
        if (tempMatch) {
          let temp = parseInt(tempMatch[1]);
          this._tempLabel.set_text(`${temp}°C`);
          // Change color based on temperature
          if (temp > 85) {
            this._tempLabel.style_class = "gpu-monitor-label temp-high";
          } else if (temp > 70) {
            this._tempLabel.style_class = "gpu-monitor-label temp-warm";
          } else {
            this._tempLabel.style_class = "gpu-monitor-label temp-normal";
          }
        }
      });

      // Get GPU memory usage
      runCommand(["rocm-smi", "--showmeminfo", "vram"], (stdout) => {
        let memMatch = stdout.match(/.*Used.*: (\d+).*/i);
        if (memMatch) {
          this._memLabel.set_text(this._formatBytes(parseInt(memMatch[1])));
        }
      });

      return true;
    }

    _formatBytes(bytes) {
      if (bytes === 0 || isNaN(bytes)) return "0 B";

      const k = 1024;
      const sizes = ["B", "KB", "MB", "GB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));

      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
    }

    destroy() {
      if (this._timeout) {
        GLib.source_remove(this._timeout);
        this._timeout = null;
      }
    }
  }
);

let indicator = null;

export default class AmdGpuMonitorExtension {
  constructor() {
    this._indicator = null;
  }

  enable() {
    indicator = new GPUMonitorIndicator();
    Main.panel.addToStatusArea("amd-gpu-monitor", indicator);
  }

  disable() {
    if (indicator) {
      indicator.destroy();
      indicator = null;
    }
  }
}
