import os
from pathlib import Path

from flask import Flask, jsonify, render_template, request
from google import genai

app = Flask(__name__)


def _load_local_env() -> None:
    # Minimal .env parser for simple KEY=VALUE lines.
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ[key] = value


_load_local_env()


def _build_quota_message(raw_error: str) -> str:
    if "API_KEY_INVALID" in raw_error or "INVALID_ARGUMENT" in raw_error:
        return "Gemini API key is invalid. Update GEMINI_API_KEY in .env and restart the app."
    if "RESOURCE_EXHAUSTED" in raw_error or "429" in raw_error:
        return (
            "Gemini quota exceeded. Please wait a bit and try again, "
            "or switch to a key/project with available quota."
        )
    return f"Gemini request failed: {raw_error}"


def _local_fallback_reply(user_message: str) -> str:
    # Keep the app usable when external quota/key issues occur.
    return (
        "Gemini is temporarily unavailable, so this is a local fallback response. "
        f"You said: {user_message}"
    )

@app.route("/")
def home():
    return render_template("index.html")


@app.route("/chat", methods=["POST"])
def chat():
    payload = request.get_json(silent=True) or {}
    user_message = payload.get("message", "")
    if not user_message.strip():
        return jsonify({"reply": "Message cannot be empty."}), 400

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return jsonify({"reply": "GEMINI_API_KEY is not set."}), 500

    client = genai.Client(api_key=api_key)
    # Try currently available models first to minimize quota/model-version failures.
    models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-lite"]
    errors = []

    for model_name in models:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=[
                    "You are a helpful AI assistant.",
                    user_message,
                ],
            )
            reply = response.text if response and response.text else "No response generated."
            return jsonify({"reply": reply})
        except Exception as exc:
            errors.append(str(exc))
            continue

    message = _build_quota_message(" | ".join(errors))

    # If quota is exhausted, return a local fallback response instead of failing.
    if "quota exceeded" in message.lower():
        return jsonify({"reply": _local_fallback_reply(user_message)})

    return jsonify({"reply": message}), 429


if __name__ == "__main__":
    app.run(debug=True, port=5001)