# Activate Unity

GitHub Action to activate personal or professional Unity license. License will be automatically returned at the end of a job.

Supports regular and custom floating licence.
Works on Linux, macOS and Windows.

## Inputs

### `unity-path`

Path to Unity executable. `UNITY_PATH` env will be used if not provided.

### `unity-username`

**Required** Unity account username.

### `unity-password`

**Required** Unity account password.

### `unity-authenticator-key`

Unity account [authenticator key](#How-to-obtain-authenticator-key) for Authenticator App (Two Factor Authentication). Used for account verification during Personal license activation.

### `unity-serial`

Unity license serial key. Used for Plus/Professional license activation.

### `audience`
Audience link for Google Cloud Function, Google Cloud Function [trigger url](https://cloud.google.com/functions/docs/console-quickstart)

### `apiKey`
API key needed for HTTP requests

## How to obtain authenticator key

1. Login to Unity account
2. Go to account settings
3. Activate Two Factor Authentication through Authenticator App
4. On page with QR code click "Can't scan the barcode?" and save key (remove spaces in it)
5. Finish activation
