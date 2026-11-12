// The Android shell. It shows the shared interface in the system web view
// and provides the platform services the interface cannot do for itself:
// sending web requests to AI services, keeping keys in the Android
// Keystore, saving files and choosing files. Learning rules never live
// here; they are in the Ankhwiz core, which runs inside the interface.
//
// This is an interim shell built with plain Android tools. The plan's Tauri
// shell replaces it once the Android SDK and NDK are available to the build.

package app.ankhwiz;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.KeyStore;
import java.util.Iterator;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public class MainActivity extends Activity {
    /** The interface is served from this address inside the app; nothing is fetched from the network for it. */
    private static final String HOST = "app.ankhwiz.local";
    private static final String START = "https://" + HOST + "/index.html";
    private static final String KEY_ALIAS = "ankhwiz-secrets";
    private static final int PICK_FILE = 1;
    private static final int SAVE_FILE = 2;

    private WebView web;
    private ValueCallback<Uri[]> pendingPick;
    private byte[] pendingSave;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setTextZoom(100);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (HOST.equals(uri.getHost()) && "/index.html".equals(uri.getPath())) {
                    try {
                        return new WebResourceResponse("text/html", "utf-8", getAssets().open("index.html"));
                    } catch (Exception e) {
                        // Falls through to the empty reply below.
                    }
                }
                // The interface needs nothing else; any other request from the page is refused.
                return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // The page never navigates away from the interface.
                return !HOST.equals(Uri.parse(url).getHost());
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingPick != null) pendingPick.onReceiveValue(null);
                pendingPick = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                // Anki packages have no registered type, so every file is offered.
                intent.setType("*/*");
                try {
                    startActivityForResult(intent, PICK_FILE);
                } catch (Exception e) {
                    pendingPick = null;
                    return false;
                }
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "AnkhwizAndroid");
        if (state == null) web.loadUrl(START);
        else web.restoreState(state);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        // The interface steps back one screen; from the library, the app closes.
        web.evaluateJavascript("window.__ankhwizBack ? window.__ankhwizBack() : false", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String handled) {
                if (!"true".equals(handled)) finish();
            }
        });
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request == PICK_FILE) {
            Uri[] picked = result == RESULT_OK && data != null && data.getData() != null ? new Uri[] { data.getData() } : null;
            if (pendingPick != null) pendingPick.onReceiveValue(picked);
            pendingPick = null;
        } else if (request == SAVE_FILE) {
            byte[] bytes = pendingSave;
            pendingSave = null;
            if (result == RESULT_OK && data != null && data.getData() != null && bytes != null) {
                try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                    out.write(bytes);
                } catch (Exception e) {
                    // The learner sees no file where they chose; nothing else to do here.
                }
            }
        }
    }

    private static String read(InputStream in) throws Exception {
        if (in == null) return "";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int n;
        while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
        in.close();
        return out.toString("UTF-8");
    }

    private SecretKey secretKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(KEY_ALIAS, null);
    }

    private SharedPreferences secrets() {
        return getSharedPreferences("secrets", MODE_PRIVATE);
    }

    /** What the interface can ask of this shell. Mirrors src/lib/platform.ts. */
    private class Bridge {
        /** Sends a web request on a background thread and answers through window.__ankhwizHttp. */
        @JavascriptInterface
        public void http(final String id, final String requestJson) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    int status = 0;
                    String body = "";
                    HttpURLConnection connection = null;
                    try {
                        JSONObject request = new JSONObject(requestJson);
                        String method = request.optString("method", "GET");
                        connection = (HttpURLConnection) new URL(request.getString("url")).openConnection();
                        connection.setRequestMethod(method);
                        connection.setConnectTimeout(15000);
                        connection.setReadTimeout(180000);
                        JSONObject headers = request.optJSONObject("headers");
                        if (headers != null) {
                            for (Iterator<String> it = headers.keys(); it.hasNext();) {
                                String name = it.next();
                                connection.setRequestProperty(name, headers.getString(name));
                            }
                        }
                        String payload = request.optString("body", "");
                        if (!"GET".equals(method) && payload.length() > 0) {
                            connection.setDoOutput(true);
                            OutputStream out = connection.getOutputStream();
                            out.write(payload.getBytes("UTF-8"));
                            out.close();
                        }
                        status = connection.getResponseCode();
                        body = read(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
                    } catch (Exception e) {
                        status = 0;
                        body = "";
                    } finally {
                        if (connection != null) connection.disconnect();
                    }
                    final String script = "window.__ankhwizHttp(" + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(body) + ")";
                    web.post(new Runnable() {
                        @Override
                        public void run() {
                            web.evaluateJavascript(script, null);
                        }
                    });
                }
            }).start();
        }

        /** Secrets are encrypted with a key held by the Android Keystore, then kept in app-private storage. */
        @JavascriptInterface
        public void setSecret(String name, String value) throws Exception {
            if (value == null || value.length() == 0) {
                secrets().edit().remove(name).apply();
                return;
            }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, secretKey());
            String stored = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":"
                    + Base64.encodeToString(cipher.doFinal(value.getBytes("UTF-8")), Base64.NO_WRAP);
            secrets().edit().putString(name, stored).apply();
        }

        @JavascriptInterface
        public String getSecret(String name) {
            try {
                String stored = secrets().getString(name, null);
                if (stored == null) return "";
                String[] parts = stored.split(":");
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
                return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), "UTF-8");
            } catch (Exception e) {
                return "";
            }
        }

        /** Opens the system's "save as" screen; the file is written where the learner chooses. */
        @JavascriptInterface
        public String saveFile(final String name, final String text) throws Exception {
            return save(name, text.getBytes("UTF-8"), "application/json");
        }

        /** The same for binary files (exported decks), sent as base64. */
        @JavascriptInterface
        public String saveBase64(final String name, final String base64) {
            return save(name, Base64.decode(base64, Base64.DEFAULT), "application/octet-stream");
        }

        private String save(final String name, final byte[] bytes, final String type) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    pendingSave = bytes;
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType(type);
                    intent.putExtra(Intent.EXTRA_TITLE, name);
                    try {
                        startActivityForResult(intent, SAVE_FILE);
                    } catch (Exception e) {
                        pendingSave = null;
                    }
                }
            });
            return "Choose where to save the file.";
        }
    }
}
