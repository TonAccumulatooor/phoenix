#!/usr/bin/env bash
# Phoenix VPS bootstrap — Ubuntu 24.04 LTS Minimal
# Run once as root on a fresh box:  bash setup-server.sh
set -euo pipefail

echo "==> [1/6] Updating system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -y -q

echo "==> [2/6] Installing base packages"
apt-get install -y -q ca-certificates curl git ufw fail2ban unattended-upgrades sqlite3

echo "==> [3/6] Installing Docker from the official repository"
install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.asc ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -q
apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

echo "==> [4/6] Configuring the firewall"
# Default deny inbound; SSH, HTTP and HTTPS are the only doors.
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   comment 'SSH'
ufw allow 80/tcp   comment 'HTTP'
ufw allow 443/tcp  comment 'HTTPS'
ufw --force enable

echo "==> [5/6] Enabling automatic security updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now unattended-upgrades

echo "==> [6/6] Hardening SSH (key-only authentication)"
# Only applied if an authorized key is already present, so we cannot lock ourselves out.
if [ -s /root/.ssh/authorized_keys ]; then
  cat > /etc/ssh/sshd_config.d/99-phoenix.conf <<'EOF'
PasswordAuthentication no
PermitRootLogin prohibit-password
KbdInteractiveAuthentication no
EOF
  # Ubuntu 24.04 uses the ssh.service unit; fall back to sshd on other spins.
  systemctl restart ssh 2>/dev/null || systemctl restart sshd
  echo "    Password authentication disabled."
else
  echo "    !! No authorized_keys found — leaving password auth ENABLED."
  echo "    !! Add your public key, then re-run this script."
fi

systemctl enable --now fail2ban

echo
echo "==> Done."
docker --version
docker compose version
echo
echo "Firewall status:"
ufw status verbose
