# 🐍 SnakeGuard – Snake Bite Detection System

A real-time snake bite detection system using Claude Vision AI, Node.js, and ESP32 with LED/buzzer alerts.

---

## 🛠 Prerequisites

- Node.js v18+
- An Anthropic API key
- ESP32 development board
- Arduino IDE with ESP32 board support

---

## 🚀 Quick Start (Node.js Server)

```bash
# 1. Navigate to project folder
cd snake-detector

# 2. Install dependencies
npm install

# 3. Set your Anthropic API key
# Option A: Environment variable (recommended)
export ANTHROPIC_API_KEY=sk-ant-xxxxxxxx

# Option B: Edit server.js line 10
#   apiKey: 'sk-ant-your-key-here'

# 4. Start the server
npm start

# Server runs at: http://localhost:3000
```

---

## ⚡ ESP32 Setup

### Hardware Wiring
```
ESP32 GPIO 2  → Red LED anode  → 220Ω resistor → GND
ESP32 GPIO 4  → Green LED anode → 220Ω resistor → GND
ESP32 GPIO 5  → Buzzer (+) pin → GND
ESP32 GND     → All component GND
```

### Arduino IDE Setup
1. Install board: **Tools → Board → ESP32 Arduino → ESP32 Dev Module**
2. Install library: **ArduinoJson** via Library Manager
3. Open `esp32/snake_guard_esp32.ino`
4. Edit these lines:
   ```cpp
   const char* WIFI_SSID     = "YOUR_WIFI_NAME";
   const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
   const char* SERVER_IP     = "192.168.x.x";  // Your PC's local IP
   ```
5. Upload to ESP32

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET  | `/api/status`        | ESP32 polls this — returns `{alert: bool}` |
| POST | `/api/detect`        | Upload image file for analysis |
| POST | `/api/detect-camera` | Send base64 image from ESP32-CAM |
| GET  | `/api/latest`        | Get the latest detection result |
| POST | `/api/reset`         | Reset system alert state |

---

## 🚦 Alert Logic

| Condition     | Red LED | Green LED | Buzzer |
|---------------|---------|-----------|--------|
| Snake bite    | BLINK   | OFF       | ON     |
| No bite       | OFF     | ON        | OFF    |
| System idle   | OFF     | ON        | OFF    |
| WiFi error    | BLINK x5| OFF       | OFF    |

---

## 📁 Project Structure

```
snake-detector/
├── server.js           # Node.js Express + Socket.io server
├── package.json        # Dependencies
├── public/
│   └── index.html      # Web dashboard (served by Express)
└── esp32/
    └── snake_guard_esp32.ino   # Arduino code for ESP32
```

---

## 🔍 How Detection Works

1. User uploads image via web dashboard (or ESP32-CAM sends frame)
2. Node.js sends image to **Claude Vision API** (claude-opus-4-5)
3. Claude analyzes for snake bite marks (fang punctures, swelling, bruising)
4. Result broadcast to dashboard via **Socket.io** in real-time
5. ESP32 polls `/api/status` every 2 seconds
6. ESP32 triggers **Red LED + Buzzer** if bite detected, else **Green LED**
