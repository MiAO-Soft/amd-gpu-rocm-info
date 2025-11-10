
mkdir -p ~/.local/share/gnome-shell/extensions/

rm -rfd ~/.local/share/gnome-shell/extensions/amd-gpu-rocm-info@black-hat

mkdir -p ~/.local/share/gnome-shell/extensions/amd-gpu-rocm-info@black-hat

cp extension.js metadata.json stylesheet.css ~/.local/share/gnome-shell/extensions/amd-gpu-rocm-info@black-hat

sudo cp ryzenadj /usr/local/bin/ryzenadj

sudo chmod +x /usr/local/bin/ryzenadj

echo "🔑 Config sudo no password for /usr/local/bin/ryzenadj..."
SUDOERS_ENTRIES=(
    "$USER ALL=(ALL) NOPASSWD: /usr/local/bin/ryzenadj"
)
for entry in "${SUDOERS_ENTRIES[@]}"; do
    if ! sudo grep -qxF "$entry" /etc/sudoers; then
        echo "$entry" | sudo EDITOR='tee -a' visudo || {
            echo "❌ Config sudo failed, please check" >&2
            exit 1
        }
    fi
done
