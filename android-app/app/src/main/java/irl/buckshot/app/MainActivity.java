package irl.buckshot.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.Context;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.Ndef;
import android.nfc.tech.NdefFormatable;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.net.wifi.WifiManager;

import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;

import java.io.ByteArrayOutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;

public class MainActivity extends Activity {
    private WebView webView;
    private NfcAdapter nfcAdapter;
    private PendingIntent nfcPendingIntent;
    private String pendingWritePayload = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        enterImmersiveMode();

        nfcAdapter = NfcAdapter.getDefaultAdapter(this);
        nfcPendingIntent = PendingIntent.getActivity(
            this,
            0,
            new Intent(this, getClass()).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
        );

        setupWebView();
        handleNfcIntent(getIntent());
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void setupWebView() {
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            settings.setAllowFileAccessFromFileURLs(true);
            settings.setAllowUniversalAccessFromFileURLs(true);
        }
        webView.setWebViewClient(new WebViewClient());
        webView.addJavascriptInterface(new AndroidNfcBridge(), "AndroidNfc");
        webView.addJavascriptInterface(new AndroidAppBridge(), "AndroidApp");
        setContentView(webView);
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    protected void onResume() {
        super.onResume();
        enterImmersiveMode();
        enableNfcForegroundDispatch();
    }

    @Override
    protected void onPause() {
        disableNfcForegroundDispatch();
        super.onPause();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNfcIntent(intent);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        IntentResult result = IntentIntegrator.parseActivityResult(requestCode, resultCode, data);
        if (result != null) {
            String contents = result.getContents();
            boolean ok = contents != null && !contents.trim().isEmpty();
            callJs("window.onNativeQrScan && window.onNativeQrScan(" + ok + "," + jsString(ok ? contents.trim() : "QR scan cancelled") + ")");
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private void enableNfcForegroundDispatch() {
        if (nfcAdapter == null) return;
        IntentFilter tag = new IntentFilter(NfcAdapter.ACTION_TAG_DISCOVERED);
        IntentFilter tech = new IntentFilter(NfcAdapter.ACTION_TECH_DISCOVERED);
        IntentFilter ndef = new IntentFilter(NfcAdapter.ACTION_NDEF_DISCOVERED);
        try {
            ndef.addDataType("text/plain");
        } catch (IntentFilter.MalformedMimeTypeException ignored) {
        }
        nfcAdapter.enableForegroundDispatch(this, nfcPendingIntent, new IntentFilter[]{ndef, tech, tag}, null);
    }

    private void disableNfcForegroundDispatch() {
        if (nfcAdapter == null) return;
        try {
            nfcAdapter.disableForegroundDispatch(this);
        } catch (IllegalStateException ignored) {
        }
    }

    private void handleNfcIntent(Intent intent) {
        if (intent == null || nfcAdapter == null) return;
        String action = intent.getAction();
        if (!NfcAdapter.ACTION_NDEF_DISCOVERED.equals(action)
            && !NfcAdapter.ACTION_TECH_DISCOVERED.equals(action)
            && !NfcAdapter.ACTION_TAG_DISCOVERED.equals(action)) {
            return;
        }

        Tag tag = intent.getParcelableExtra(NfcAdapter.EXTRA_TAG);
        if (tag == null) return;

        String writePayload = pendingWritePayload;
        if (writePayload != null && !writePayload.isEmpty()) {
            boolean ok = writeTextTag(tag, writePayload);
            pendingWritePayload = "";
            callJs("window.onNativeNfcWrite && window.onNativeNfcWrite(" + ok + "," + jsString(ok ? "Tag written" : "Write failed") + ")");
            return;
        }

        String payload = readTextPayload(intent, tag);
        if (payload == null || payload.isEmpty()) {
            payload = "serial:" + bytesToHex(tag.getId());
        }
        callJs("window.onNativeNfcRead && window.onNativeNfcRead(" + jsString(payload) + ")");
    }

    private String readTextPayload(Intent intent, Tag tag) {
        NdefMessage[] messages = null;
        Object[] raw = intent.getParcelableArrayExtra(NfcAdapter.EXTRA_NDEF_MESSAGES);
        if (raw != null) {
            messages = Arrays.copyOf(raw, raw.length, NdefMessage[].class);
        }
        if (messages == null || messages.length == 0) {
            Ndef ndef = Ndef.get(tag);
            if (ndef != null) {
                try {
                    ndef.connect();
                    NdefMessage message = ndef.getNdefMessage();
                    if (message != null) messages = new NdefMessage[]{message};
                } catch (Exception ignored) {
                } finally {
                    try {
                        ndef.close();
                    } catch (Exception ignored) {
                    }
                }
            }
        }
        if (messages == null) return "";
        for (NdefMessage message : messages) {
            for (NdefRecord record : message.getRecords()) {
                String text = readTextRecord(record);
                if (!text.isEmpty()) return text;
            }
        }
        return "";
    }

    private String readTextRecord(NdefRecord record) {
        try {
            if (record.getTnf() == NdefRecord.TNF_WELL_KNOWN && Arrays.equals(record.getType(), NdefRecord.RTD_TEXT)) {
                byte[] payload = record.getPayload();
                if (payload.length == 0) return "";
                int languageLength = payload[0] & 0x3f;
                Charset charset = (payload[0] & 0x80) == 0 ? StandardCharsets.UTF_8 : StandardCharsets.UTF_16;
                return new String(payload, 1 + languageLength, payload.length - 1 - languageLength, charset);
            }
            if (record.getTnf() == NdefRecord.TNF_MIME_MEDIA) {
                return new String(record.getPayload(), StandardCharsets.UTF_8);
            }
        } catch (Exception ignored) {
        }
        return "";
    }

    private boolean writeTextTag(Tag tag, String text) {
        NdefRecord record = createTextRecord(text);
        NdefMessage message = new NdefMessage(new NdefRecord[]{record});
        Ndef ndef = Ndef.get(tag);
        if (ndef != null) {
            try {
                ndef.connect();
                if (!ndef.isWritable() || ndef.getMaxSize() < message.toByteArray().length) return false;
                ndef.writeNdefMessage(message);
                return true;
            } catch (Exception ignored) {
                return false;
            } finally {
                try {
                    ndef.close();
                } catch (Exception ignored) {
                }
            }
        }
        NdefFormatable formatable = NdefFormatable.get(tag);
        if (formatable != null) {
            try {
                formatable.connect();
                formatable.format(message);
                return true;
            } catch (Exception ignored) {
                return false;
            } finally {
                try {
                    formatable.close();
                } catch (Exception ignored) {
                }
            }
        }
        return false;
    }

    private NdefRecord createTextRecord(String text) {
        byte[] language = Locale.ENGLISH.getLanguage().getBytes(StandardCharsets.US_ASCII);
        byte[] payload = text.getBytes(StandardCharsets.UTF_8);
        ByteArrayOutputStream out = new ByteArrayOutputStream(1 + language.length + payload.length);
        out.write(language.length & 0x3f);
        out.write(language, 0, language.length);
        out.write(payload, 0, payload.length);
        return new NdefRecord(NdefRecord.TNF_WELL_KNOWN, NdefRecord.RTD_TEXT, new byte[0], out.toByteArray());
    }

    private void enterImmersiveMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        }
    }

    private void callJs(String script) {
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript(script, null);
        });
    }

    private String jsString(String value) {
        if (value == null) return "\"\"";
        return "\"" + value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r") + "\"";
    }

    private String bytesToHex(byte[] bytes) {
        StringBuilder builder = new StringBuilder();
        for (byte b : bytes) {
            builder.append(String.format(Locale.US, "%02x", b));
        }
        return builder.toString();
    }

    public class AndroidNfcBridge {
        @JavascriptInterface
        public boolean isAvailable() {
            return nfcAdapter != null;
        }

        @JavascriptInterface
        public void startRead() {
            pendingWritePayload = "";
            callJs("window.onNativeNfcStatus && window.onNativeNfcStatus(" + jsString(nfcAdapter == null ? "NFC unavailable" : "NFC listening") + ")");
        }

        @JavascriptInterface
        public void cancel() {
            pendingWritePayload = "";
            callJs("window.onNativeNfcStatus && window.onNativeNfcStatus(" + jsString("NFC cancelled") + ")");
        }

        @JavascriptInterface
        public void write(String payload) {
            pendingWritePayload = payload == null ? "" : payload;
            callJs("window.onNativeNfcStatus && window.onNativeNfcStatus(" + jsString("Approach NFC tag to write") + ")");
        }
    }

    public class AndroidAppBridge {
        @JavascriptInterface
        public void vibrate(String patternCsv) {
            Vibrator vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (vibrator == null) return;
            String[] parts = patternCsv == null ? new String[0] : patternCsv.split(",");
            long[] pattern = new long[Math.max(1, parts.length)];
            for (int i = 0; i < pattern.length; i++) {
                try {
                    pattern[i] = Long.parseLong(parts[i].trim());
                } catch (Exception ignored) {
                    pattern[i] = 45;
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1));
            } else {
                vibrator.vibrate(pattern, -1);
            }
        }

        @JavascriptInterface
        public void keepAwake() {
            runOnUiThread(() -> getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));
        }

        @JavascriptInterface
        public void immersive() {
            runOnUiThread(MainActivity.this::enterImmersiveMode);
        }

        @JavascriptInterface
        public void discoverHost() {
            new Thread(() -> {
                String url = discoverBuckshotUrl();
                callJs("window.onNativeDiscovery && window.onNativeDiscovery(" + (!url.isEmpty()) + "," + jsString(url) + ")");
            }, "buckshot-discovery").start();
        }

        @JavascriptInterface
        public void scanQr() {
            runOnUiThread(() -> {
                IntentIntegrator integrator = new IntentIntegrator(MainActivity.this);
                integrator.setDesiredBarcodeFormats(IntentIntegrator.QR_CODE);
                integrator.setPrompt("Scan SoupShot TFT QR");
                integrator.setBeepEnabled(false);
                integrator.setOrientationLocked(true);
                integrator.initiateScan();
            });
        }
    }

    private String discoverBuckshotUrl() {
        final int port = 4210;
        byte[] request = "buckshot:discover".getBytes(StandardCharsets.UTF_8);
        byte[] response = new byte[128];
        WifiManager.MulticastLock lock = null;
        try {
            WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) {
                lock = wifi.createMulticastLock("buckshot-discovery");
                lock.setReferenceCounted(false);
                lock.acquire();
            }
        } catch (Exception ignored) {
        }
        try (DatagramSocket socket = new DatagramSocket(null)) {
            socket.setReuseAddress(true);
            socket.setBroadcast(true);
            socket.bind(new InetSocketAddress(0));
            socket.setSoTimeout(650);

            InetAddress[] targets = new InetAddress[]{
                InetAddress.getByName("255.255.255.255"),
                InetAddress.getByName("192.168.4.255")
            };
            for (InetAddress target : targets) {
                socket.send(new DatagramPacket(request, request.length, target, port));
            }

            long deadline = System.currentTimeMillis() + 900;
            while (System.currentTimeMillis() < deadline) {
                try {
                    DatagramPacket packet = new DatagramPacket(response, response.length);
                    socket.receive(packet);
                    String text = new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8);
                    if (text.startsWith("buckshot:esp32:")) {
                        return text.substring("buckshot:esp32:".length());
                    }
                } catch (SocketTimeoutException ignored) {
                    break;
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (lock != null && lock.isHeld()) {
                try {
                    lock.release();
                } catch (Exception ignored) {
                }
            }
        }
        return "";
    }
}
