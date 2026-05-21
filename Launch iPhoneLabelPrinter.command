#!/bin/zsh

set -u

PROJECT_DIR="${0:A:h}"
cd "$PROJECT_DIR" || exit 1

show_error() {
  /usr/bin/osascript -e "display dialog \"$1\" buttons {\"OK\"} default button \"OK\" with icon stop" >/dev/null
}

if [[ ! -f "app.py" ]]; then
  show_error "app.py was not found next to this launcher."
  exit 1
fi

if [[ ! -x ".venv/bin/python" ]]; then
  show_error "The local Python environment is missing. Open Terminal in this folder and run: python3.12 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

".venv/bin/python" "app.py"
status=$?

if [[ "$status" -ne 0 ]]; then
  show_error "iPhoneLabelPrinter closed with an error. Run the launcher from Terminal to see the technical details."
fi

exit "$status"
