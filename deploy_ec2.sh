#!/bin/bash
set -e

echo "=== Setting up Skin & Eye Health Screening on AWS EC2 ==="

# 1. Update packages and install Python 3.11 + venv
sudo apt-get update -y
sudo apt-get install -y python3-pip python3-venv git curl

# 2. Add swapfile if instance has <= 2GB RAM (essential for t2.micro/t3.micro/t3.small with TensorFlow)
TOTAL_RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
if [ "$TOTAL_RAM_MB" -lt 3000 ]; then
    if [ ! -f /swapfile ]; then
        echo "Adding 4GB swap space for TensorFlow..."
        sudo fallocate -l 4G /swapfile
        sudo chmod 600 /swapfile
        sudo mkswap /swapfile
        sudo swapon /swapfile
        echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    fi
fi

# 3. Create virtual environment and install dependencies
cd "$(dirname "$0")/backend"
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi

source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# 4. Optional: Create systemd service for auto-restart
SERVICE_FILE=/etc/systemd/system/screening.service
REPO_DIR="$(cd .. && pwd)"

echo "Creating systemd service at $SERVICE_FILE..."
sudo tee $SERVICE_FILE > /dev/null <<EOF
[Unit]
Description=Skin & Eye Screening FastAPI Service
After=network.target

[Service]
User=$USER
WorkingDirectory=$REPO_DIR/backend
ExecStart=$REPO_DIR/backend/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable screening
sudo systemctl restart screening

echo "=== Deployment Complete! ==="
echo "Service is running on port 8000."
echo "Check status with: sudo systemctl status screening"
echo "View logs with: journalctl -u screening -f"
