# WaveCode

WaveCode is a production-oriented Visual Studio Code extension plus a local Python backend that lets developers trigger common editor actions with hand gestures.

The first version is intentionally narrow:

- Five supported gestures
- Local-only processing
- Official VS Code command execution
- MediaPipe hand landmarks plus a lightweight classifier
- A native-feeling sidebar for status, controls, and recent activity

## Architecture

```text
Webcam
  ↓
OpenCV Camera Stream
  ↓
MediaPipe Hands
  ↓
21 Hand Landmarks
  ↓
WaveCode Classifier
  ↓
FastAPI WebSocket
  ↓
VS Code Extension
  ↓
Execute VS Code Command
```

## Repository Layout

```text
wavecode/
├── extension/
│   ├── media/
│   ├── src/
│   │   ├── commands.ts
│   │   ├── extension.ts
│   │   ├── settings.ts
│   │   ├── sidebar.ts
│   │   └── websocket.ts
│   ├── package.json
│   └── tsconfig.json
├── backend/
│   ├── app.py
│   ├── camera.py
│   ├── classifier.py
│   ├── inference.py
│   ├── mediapipe_detector.py
│   ├── requirements.txt
│   ├── train.py
│   └── websocket.py
├── dataset/
├── model/
└── README.md
```

## Supported Gestures

| Gesture | Internal ID | Default Action |
| --- | --- | --- |
| 👍 | `thumbs_up` | Save File |
| ✌️ | `peace` | Toggle Terminal |
| ✊ | `fist` | Open Command Palette |
| ☝️ | `point` | Next Editor Tab |
| 🖐️ | `open_palm` | Toggle Sidebar |

Default command mappings use official VS Code command IDs:

- `thumbs_up` → `workbench.action.files.save`
- `peace` → `workbench.action.terminal.toggleTerminal`
- `fist` → `workbench.action.showCommands`
- `point` → `workbench.action.nextEditor`
- `open_palm` → `workbench.action.toggleSidebarVisibility`

## Features

- Real-time gesture recognition pipeline with MediaPipe landmarks
- Confidence threshold filtering in the extension
- Per-gesture cooldown to prevent duplicate execution
- Auto-reconnecting WebSocket client
- Auto-starting backend process from the extension
- Configurable gesture-to-command mappings
- Sidebar with:
  - Camera status
  - Current gesture
  - Confidence
  - Mapped action
  - Connection status
  - Enable detection toggle
  - Recognition threshold slider
  - Recent gesture history

## Installation

### 1. Install the Python backend dependencies

Create and activate a virtual environment, then install requirements:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Install extension dependencies

```bash
cd extension
npm install
```

### 3. Launch the extension in VS Code

Open the repository in VS Code, then:

1. Open the `extension/` folder in the editor or workspace.
2. Run `npm run compile` inside `extension/`.
3. Press `F5` from the extension project to launch an Extension Development Host.

The extension will attempt to start the backend automatically with the configured Python executable.

## Running the Backend Manually

If you prefer to run the backend yourself:

```bash
cd backend
source .venv/bin/activate
python app.py --host 127.0.0.1 --port 8765
```

Then set `wavecode.autoStartBackend` to `false` in VS Code settings.

## Extension Settings

WaveCode persists settings through the VS Code configuration system:

- `wavecode.enabled`
- `wavecode.recognitionThreshold`
- `wavecode.cooldownMs`
- `wavecode.autoStartBackend`
- `wavecode.pythonPath`
- `wavecode.backendHost`
- `wavecode.backendPort`
- `wavecode.gestureMappings`

Example custom mapping:

```json
"wavecode.gestureMappings": {
  "thumbs_up": "workbench.action.tasks.runTask",
  "peace": "workbench.action.terminal.toggleTerminal",
  "fist": "workbench.action.showCommands",
  "point": "workbench.action.nextEditor",
  "open_palm": "workbench.action.toggleSidebarVisibility"
}
```

## Model and Training

WaveCode supports two inference modes:

1. Fallback heuristic mode
   Used automatically when `model/gesture_model.pkl` is not present. This makes the MVP usable without collecting a custom dataset first.
2. Trained classifier mode
   Enabled when a model produced by `backend/train.py` exists.

### Dataset Format

Create `dataset/gestures.csv` with:

- One row per sample
- A `label` column
- `63` numeric feature columns representing flattened `x`, `y`, `z` landmarks for `21` points

Recommended target:

- Approximately `300` samples per gesture
- Balanced classes across all five gestures

### Training

```bash
cd backend
source .venv/bin/activate
python train.py
```

The training script:

- Splits data `80/20`
- Trains a lightweight scikit-learn classifier
- Prints accuracy, precision, recall, and F1 score
- Saves the trained bundle to `model/gesture_model.pkl`

## Performance Targets

- Recognition latency under `100 ms`
- Stable real-time inference
- No duplicate gesture execution within the cooldown window
- Sustained frame rate above `20 FPS` on typical developer hardware

## Error Handling

WaveCode handles:

- Camera unavailable
- No hand detected
- Backend offline
- Low-confidence predictions
- Automatic WebSocket reconnection

Errors and backend logs are written to the `WaveCode` output channel in VS Code.

## Development Workflow

### Compile the extension

```bash
cd extension
npm run compile
```

### Package the extension

```bash
cd extension
npm run package
```

The VSIX packaging flow copies `../backend` and `../model` into `extension/vendor/` during `vscode:prepublish`, so the packaged extension can launch the local Python service without depending on sibling repo paths.

### Health check the backend

```bash
curl http://127.0.0.1:8765/health
```

## Deployment Notes

- Package the extension as a VSIX from `extension/`.
- Ship the Python backend alongside the repository or extension bundle.
- Use a managed Python environment for reliable dependency installation.
- For production distribution, consider bundling the backend with a platform-aware launcher or installer.

## Future Improvements

- Cursor support
- IntelliJ plugin support
- Gesture recording and dataset collection tooling
- User-defined gesture training
- Two-hand gestures
- Better false-positive suppression using temporal smoothing
- On-device calibration per user and camera

## Screenshots

Placeholder:

- Sidebar status panel
- Gesture detection in action
- Settings customization screen
