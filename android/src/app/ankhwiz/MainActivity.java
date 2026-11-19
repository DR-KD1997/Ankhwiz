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
import android.os.Build;
import android.os.Bundle;
import android.content.pm.PackageManager;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.speech.tts.TextToSpeech;
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
import java.util.Locale;

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
    /** The phone's own text-to-speech, for reading cards aloud. */
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;
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
                // The page never navigates away from the interface; an https
                // link (a new release, say) opens in the phone's browser.
                if (HOST.equals(Uri.parse(url).getHost())) return false;
                openInBrowser(url);
                return true;
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

        startSpeech(getSharedPreferences("speech", MODE_PRIVATE).getString("engine", ""));

        web.addJavascriptInterface(new Bridge(), "AnkhwizAndroid");
        if (state == null) web.loadUrl(START);
        else web.restoreState(state);
        takeShare(getIntent());
    }

    /** Something shared to Ankhwiz from another app, waiting for the interface to take it. */
    private volatile String pendingShare = "";

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (takeShare(intent)) web.evaluateJavascript("window.dispatchEvent(new Event('ankhwiz-share'))", null);
    }

    /**
     * Keeps a shared web address, text or file (a PDF, a Word document, text)
     * for the interface, which offers to add it to a deck. Files are read here,
     * up to 25 MB, and handed over as base64.
     */
    private boolean takeShare(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return false;
        try {
            JSONObject out = new JSONObject();
            Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (stream != null) {
                String name = "shared";
                android.database.Cursor c = getContentResolver().query(stream, new String[] { android.provider.OpenableColumns.DISPLAY_NAME }, null, null, null);
                if (c != null) {
                    if (c.moveToFirst()) name = c.getString(0);
                    c.close();
                }
                InputStream in = getContentResolver().openInputStream(stream);
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] chunk = new byte[65536];
                int n;
                while (in != null && (n = in.read(chunk)) > 0) {
                    buf.write(chunk, 0, n);
                    if (buf.size() > 25 * 1024 * 1024) throw new Exception("too big");
                }
                if (in != null) in.close();
                out.put("kind", "file");
                out.put("name", name);
                out.put("type", intent.getType() == null ? "" : intent.getType());
                out.put("base64", Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP));
            } else {
                String text = intent.getStringExtra(Intent.EXTRA_TEXT);
                if (text == null || text.trim().isEmpty()) return false;
                out.put("kind", "text");
                out.put("text", text);
                String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
                out.put("subject", subject == null ? "" : subject);
            }
            pendingShare = out.toString();
            return true;
        } catch (Exception e) {
            pendingShare = "{\"kind\":\"error\"}";
            return true;
        }
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        super.onDestroy();
    }

    /** Starts the text-to-speech engine: the one chosen in Ankhwiz, or the phone's default. */
    private void startSpeech(String engine) {
        ttsReady = false;
        if (tts != null) tts.shutdown();
        TextToSpeech.OnInitListener ready = new TextToSpeech.OnInitListener() {
            @Override
            public void onInit(int status) {
                ttsReady = status == TextToSpeech.SUCCESS;
            }
        };
        tts = engine == null || engine.isEmpty() ? new TextToSpeech(this, ready) : new TextToSpeech(this, ready, engine);
    }

    private void openInBrowser(String url) {
        if (url == null || !url.startsWith("https://")) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception e) {
            // No browser installed: nothing to open it with.
        }
    }

    private Locale localeOf(String lang) {
        return lang == null || lang.isEmpty() ? Locale.getDefault() : Locale.forLanguageTag(lang.replace('_', '-'));
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
        /** The item shared to Ankhwiz, once: JSON, or empty when there is none. */
        @JavascriptInterface
        public String takeShared() {
            String s = pendingShare;
            pendingShare = "";
            return s;
        }

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

        /** The daily reminder: on or off, the time, the days of the week (0 = Sunday) and what it says. */
        @JavascriptInterface
        public void setReminder(boolean on, int hour, int minute, String days, String text) {
            getSharedPreferences(ReminderReceiver.PREFS, MODE_PRIVATE).edit()
                    .putBoolean("on", on).putInt("hour", hour).putInt("minute", minute)
                    .putString("days", days).putString("text", text).apply();
            ReminderReceiver.schedule(MainActivity.this);
        }

        /** Something was studied today (a local day number): no reminder today. */
        @JavascriptInterface
        public void markStudied(long day) {
            getSharedPreferences(ReminderReceiver.PREFS, MODE_PRIVATE).edit().putLong("studied", day).apply();
        }

        /** Ask to show notifications (Android 13 and later ask the learner). Returns granted, asked or off. */
        @JavascriptInterface
        public String askNotifications() {
            if (Build.VERSION.SDK_INT < 33) return "granted";
            String permission = "android.permission.POST_NOTIFICATIONS";
            if (checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) return "granted";
            requestPermissions(new String[] { permission }, 3);
            return "asked";
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

        /** Opens an https page in the phone's browser. */
        @JavascriptInterface
        public void openLink(final String url) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    openInBrowser(url);
                }
            });
        }

        /** Reads text aloud: "ok", "no-voice" when the language has no voice installed, or "not-ready". */
        @JavascriptInterface
        public String speak(String text, String lang) {
            if (!ttsReady) return "not-ready";
            Locale locale = localeOf(lang);
            if (tts.isLanguageAvailable(locale) < TextToSpeech.LANG_AVAILABLE) return "no-voice";
            tts.setLanguage(locale);
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "ankhwiz");
            return "ok";
        }

        /**
         * Reads pieces one after another, each in its own language: JSON
         * [{"text": ..., "lang": ...}]. Each utterance keeps the language set
         * when it was queued, so the voices take turns without overlapping.
         */
        @JavascriptInterface
        public String speakPieces(String json) {
            if (!ttsReady) return "not-ready";
            try {
                org.json.JSONArray list = new org.json.JSONArray(json);
                int queued = 0;
                for (int i = 0; i < list.length(); i++) {
                    org.json.JSONObject p = list.getJSONObject(i);
                    String text = p.optString("text", "");
                    if (text.trim().isEmpty()) continue;
                    Locale locale = localeOf(p.optString("lang", ""));
                    if (tts.isLanguageAvailable(locale) < TextToSpeech.LANG_AVAILABLE) continue;
                    tts.setLanguage(locale);
                    tts.speak(text, queued == 0 ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, null, "ankhwiz-" + i);
                    queued++;
                }
                return queued > 0 ? "ok" : "no-voice";
            } catch (org.json.JSONException e) {
                return "error";
            }
        }

        /** The speech engines on this phone, as JSON [{"name": package, "label": shown name}], and the one in use. */
        @JavascriptInterface
        public String speechEngines() {
            try {
                org.json.JSONObject out = new org.json.JSONObject();
                org.json.JSONArray list = new org.json.JSONArray();
                if (tts != null) {
                    for (TextToSpeech.EngineInfo e : tts.getEngines()) {
                        org.json.JSONObject o = new org.json.JSONObject();
                        o.put("name", e.name);
                        o.put("label", e.label);
                        list.put(o);
                    }
                    out.put("current", tts.getDefaultEngine());
                }
                out.put("chosen", getSharedPreferences("speech", MODE_PRIVATE).getString("engine", ""));
                out.put("engines", list);
                return out.toString();
            } catch (org.json.JSONException e) {
                return "{}";
            }
        }

        /** Use another speech engine ("" for the phone's default); it starts again in the background. */
        @JavascriptInterface
        public void setSpeechEngine(final String name) {
            getSharedPreferences("speech", MODE_PRIVATE).edit().putString("engine", name == null ? "" : name).apply();
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    startSpeech(name);
                }
            });
        }

        /** Opens the phone's text-to-speech settings, where voices are added. */
        @JavascriptInterface
        public void openSpeechSettings() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        startActivity(new Intent("com.android.settings.TTS_SETTINGS").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    } catch (Exception e) {
                        try {
                            startActivity(new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                        } catch (Exception ignored) {
                            // Nothing on this phone can show them.
                        }
                    }
                }
            });
        }

        @JavascriptInterface
        public void stopSpeaking() {
            if (ttsReady) tts.stop();
        }

        /** "yes" or "no" for a language's voice, or "not-ready". */
        @JavascriptInterface
        public String voiceFor(String lang) {
            if (!ttsReady) return "not-ready";
            return tts.isLanguageAvailable(localeOf(lang)) >= TextToSpeech.LANG_AVAILABLE ? "yes" : "no";
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
