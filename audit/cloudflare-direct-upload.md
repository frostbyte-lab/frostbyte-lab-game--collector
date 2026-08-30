# Cloudflare Direct Upload Notes

Source: https://developers.cloudflare.com/workers/static-assets/direct-upload/

Cloudflare static assets use a three-step flow: register an asset manifest with `POST /accounts/{account_id}/workers/scripts/{script_name}/assets-upload-session`, upload required file hashes as base64 multipart data to `POST /accounts/{account_id}/workers/assets/upload?base64=true`, then deploy the Worker with `PUT /accounts/{account_id}/workers/scripts/{script_name}`. The final upload response provides a completion JWT; the deploy metadata uses `main_module`, `assets.jwt`, and `compatibility_date`. If the existing asset set should be reused, the deployment metadata may use `keep_assets: true`. The upload request must use multipart/form-data, and the asset manifest hashes are 32 hexadecimal characters. Retrieved during the deployment task.
