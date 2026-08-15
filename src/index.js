@@
-      // Guard ukuran ZIP response
-      if (zipData.byteLength > MAX_ZIP_RESPONSE) {
-        return tooLargeResponse({
-          id,
-          totalFiles: manifest.length,
-          rawBytes: rawTotal,
-          zipBytes: zipData.byteLength,
-          skippedLargeFiles: sizeState.skippedLarge,
-          stoppedForSize: sizeState.stoppedForSize
-        });
-      }
-
-      // Simpan ke R2 jika bucket sudah di-bind (opsional — bukan syarat)
-      if (env.COLLECTOR_BUCKET) {
-        await env.COLLECTOR_BUCKET.put(zipKey, zipData, {
-          httpMetadata: {
-            contentType: "application/zip",
-            contentDisposition: `attachment; filename="game-package-${id}.zip"`
-          }
-        });
-      }
+      // Guard ukuran ZIP response
+      if (zipData.byteLength > MAX_ZIP_RESPONSE) {
+        // If R2 is not available, fallback to GitHub Actions for large packages.
+        if (!env.COLLECTOR_BUCKET) {
+          // Dispatch workflow to run the capture on GitHub Actions (artifact upload)
+          try {
+            const dispatch = await ghFetch(env, `/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/dispatches`, {
+              method: "POST",
+              headers: { "Content-Type": "application/json" },
+              body: JSON.stringify({
+                ref: "main",
+                inputs: { url: target.href, wait_seconds: String(body.wait_seconds || 8), fallback_from_worker: "true", worker_id: id }
+              })
+            });
+            if (dispatch.status === 204 || dispatch.ok) {
+              await new Promise(r => setTimeout(r, 1500));
+              const runs = await ghFetch(env, `/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/runs?per_page=5&event=workflow_dispatch`);
+              const run = runs.data?.workflow_runs?.[0] || null;
+              return Response.json({
+                ok: true,
+                fallback: "github_actions",
+                message: "Package terlalu besar untuk Worker — fallback ke GitHub Actions. Tunggu beberapa menit lalu periksa status.",
+                run_id: run?.id || null,
+                run_url: run?.html_url || `https://github.com/${GH_OWNER}/${GH_REPO}/actions`,
+                note: "Gunakan /api/github/status?run_id=... untuk melihat progress"
+              });
+            }
+          } catch (dE) {
+            return Response.json({ error: "GITHUB_DISPATCH_FAILED", detail: String(dE && (dE.message || dE)) }, { status: 500 });
+          }
+        }
+
+        return tooLargeResponse({
+          id,
+          totalFiles: manifest.length,
+          rawBytes: rawTotal,
+          zipBytes: zipData.byteLength,
+          skippedLargeFiles: sizeState.skippedLarge,
+          stoppedForSize: sizeState.stoppedForSize
+        });
+      }
+
+      // Simpan ke R2 jika bucket sudah di-bind (opsional — bukan syarat)
+      if (env.COLLECTOR_BUCKET) {
+        try {
+          await env.COLLECTOR_BUCKET.put(zipKey, zipData, {
+            httpMetadata: {
+              contentType: "application/zip",
+              contentDisposition: `attachment; filename="game-package-${id}.zip"`
+            }
+          });
+        } catch (r2e) {
+          // If R2 write fails, fall back to GitHub Actions if available, otherwise return ZIP.
+          try {
+            const dispatch = await ghFetch(env, `/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/dispatches`, {
+              method: "POST",
+              headers: { "Content-Type": "application/json" },
+              body: JSON.stringify({
+                ref: "main",
+                inputs: { url: target.href, wait_seconds: String(body.wait_seconds || 8), fallback_from_worker: "true", worker_id: id }
+              })
+            });
+            if (dispatch.status === 204 || dispatch.ok) {
+              await new Promise(r => setTimeout(r, 1500));
+              const runs = await ghFetch(env, `/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/runs?per_page=5&event=workflow_dispatch`);
+              const run = runs.data?.workflow_runs?.[0] || null;
+              return Response.json({
+                ok: true,
+                fallback: "github_actions",
+                message: "Gagal tulis ke R2 — fallback ke GitHub Actions. Tunggu beberapa menit lalu periksa status.",
+                run_id: run?.id || null,
+                run_url: run?.html_url || `https://github.com/${GH_OWNER}/${GH_REPO}/actions`
+              });
+            }
+          } catch (dE) {
+            // swallow and continue to return ZIP below if dispatch fails
+          }
+        }
+      }
