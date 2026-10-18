package fr.pioneerremote.app;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiManager;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import androidx.core.content.FileProvider;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Réseau local pour la WebView : sockets TCP bruts (protocole Pioneer, ports 23 / 8102), découverte SSDP en multicast
 * et liste des adresses IPv4 locales. Le protocole lui-même est en JavaScript (même code que la version navigateur).
 */
@CapacitorPlugin(
    name = "PioneerNet",
    permissions = { @Permission(strings = { "android.permission.ACCESS_LOCAL_NETWORK" }, alias = "localNetwork") }
)
public class PioneerNetPlugin extends Plugin {
    private final ConcurrentHashMap<Integer, Socket> sockets = new ConcurrentHashMap<>();
    private final AtomicInteger ids = new AtomicInteger(1);
    private final ExecutorService pool = Executors.newCachedThreadPool();
    // Les écritures restent dans l'ordre : un seul thread.
    private final ExecutorService writer = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        // Sans Internet sur le Wi-Fi, Android peut router le trafic vers le mobile : on force le Wi-Fi pour ce processus.
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            for (Network n : cm.getAllNetworks()) {
                NetworkCapabilities caps = cm.getNetworkCapabilities(n);
                if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                    cm.bindProcessToNetwork(n);
                    break;
                }
            }
        } catch (Exception ignored) { /* pas de Wi-Fi : on garde le réseau par défaut */ }
    }

    /** Android 16 : accès au réseau local en permission d'exécution ; inutile avant. */
    @PluginMethod
    @Override
    public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT < 36) {
            call.resolve();
            return;
        }
        super.requestPermissions(call);
    }

    /** Boutons de volume du téléphone : interceptés par MainActivity et renvoyés à la WebView quand c'est activé. */
    @PluginMethod
    public void setVolumeKeys(PluginCall call) {
        MainActivity.volumeKeys = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        call.resolve();
    }

    /**
     * Rapport de diagnostic : fichier JSON écrit dans le cache et partagé (FileProvider). Avec « email », seules les
     * applis de messagerie sont proposées, destinataire et objet déjà remplis ; sinon, menu de partage complet.
     */
    @PluginMethod
    public void shareReport(PluginCall call) {
        String text = call.getString("text", "");
        String fileName = call.getString("fileName", "pioneer-report.json").replaceAll("[^\\w.\\-]", "_");
        String subject = call.getString("subject", "");
        String body = call.getString("body", "");
        String email = call.getString("email", "");
        try {
            File dir = new File(getContext().getCacheDir(), "reports");
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("cache inaccessible");
            File f = new File(dir, fileName);
            try (FileOutputStream out = new FileOutputStream(f)) { out.write(text.getBytes(StandardCharsets.UTF_8)); }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("application/json");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, subject);
            send.putExtra(Intent.EXTRA_TEXT, body);
            send.setClipData(ClipData.newRawUri(fileName, uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (!email.isEmpty()) {
                send.putExtra(Intent.EXTRA_EMAIL, new String[] { email });
                Intent mailOnly = new Intent(send);
                mailOnly.setSelector(new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:")));
                try {
                    getActivity().startActivity(mailOnly);
                    call.resolve();
                    return;
                } catch (ActivityNotFoundException ignored) { /* aucune appli de mail : menu de partage */ }
            }
            getActivity().startActivity(Intent.createChooser(send, email.isEmpty() ? "Partager le rapport" : "Envoyer le rapport"));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "partage impossible");
        }
    }

    /** Ouvre un lien (dépôt, mise à jour, Patreon) dans le navigateur du téléphone. */
    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith("https://")) {
            call.reject("Lien refusé");
            return;
        }
        try {
            Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(view);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Aucun navigateur");
        }
    }

    @PluginMethod
    public void connect(PluginCall call) {
        final String host = call.getString("host");
        final int port = call.getInt("port", 0);
        final int timeout = call.getInt("timeout", 5000);
        if (host == null || port <= 0) {
            call.reject("Adresse invalide");
            return;
        }
        pool.execute(() -> {
            Socket s = new Socket();
            try {
                s.connect(new InetSocketAddress(host, port), timeout);
                s.setTcpNoDelay(true);
                s.setKeepAlive(true);   // détecte une connexion à moitié fermée (ampli débranché)
            } catch (Exception e) {
                try { s.close(); } catch (Exception ignored) { }
                call.reject(e.getMessage() != null ? e.getMessage() : "connexion impossible");
                return;
            }
            final int id = ids.getAndIncrement();
            sockets.put(id, s);
            JSObject r = new JSObject();
            r.put("id", id);
            call.resolve(r);
            readLoop(id, s);
        });
    }

    private void readLoop(int id, Socket s) {
        pool.execute(() -> {
            String error = null;
            try {
                InputStream in = s.getInputStream();
                byte[] buf = new byte[2048];
                int n;
                while ((n = in.read(buf)) >= 0) {
                    JSObject o = new JSObject();
                    o.put("id", id);
                    o.put("data", new String(buf, 0, n, StandardCharsets.ISO_8859_1));
                    notifyListeners("tcpData", o);
                }
            } catch (Exception e) {
                error = e.getMessage();
            }
            // Fermé côté ampli ou erreur réseau (pas de notification si JS a déjà fermé le socket)
            if (sockets.remove(id) != null) {
                try { s.close(); } catch (Exception ignored) { }
                JSObject o = new JSObject();
                o.put("id", id);
                if (error != null) o.put("error", error);
                notifyListeners("tcpClose", o);
            }
        });
    }

    @PluginMethod
    public void write(PluginCall call) {
        final Socket s = sockets.get(call.getInt("id", -1));
        final String data = call.getString("data");
        if (s == null || data == null) {
            call.reject("Socket fermé");
            return;
        }
        writer.execute(() -> {
            try {
                s.getOutputStream().write(data.getBytes(StandardCharsets.ISO_8859_1));
                s.getOutputStream().flush();
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "écriture impossible");
            }
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        Socket s = sockets.remove(call.getInt("id", -1));
        if (s != null) {
            try { s.close(); } catch (Exception ignored) { }
        }
        call.resolve();
    }

    @PluginMethod
    public void localAddresses(PluginCall call) {
        JSArray list = new JSArray();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof java.net.Inet4Address) list.put(a.getHostAddress());
                }
            }
        } catch (Exception ignored) { }
        JSObject r = new JSObject();
        r.put("addresses", list);
        call.resolve(r);
    }

    /** Recherche UPnP : renvoie { host, xml } pour chaque appareil qui répond (le tri Pioneer se fait côté JS). */
    @PluginMethod
    public void ssdp(PluginCall call) {
        final int timeout = call.getInt("timeout", 3000);
        pool.execute(() -> {
            WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            WifiManager.MulticastLock lock = null;
            Set<String> seen = new HashSet<>();
            JSArray out = new JSArray();
            try {
                if (wifi != null) {
                    lock = wifi.createMulticastLock("pioneer-ssdp");
                    lock.setReferenceCounted(false);
                    lock.acquire();
                }
                DatagramSocket sock = new DatagramSocket();
                sock.setSoTimeout(300);
                byte[] msg = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: upnp:rootdevice\r\n\r\n")
                    .getBytes(StandardCharsets.US_ASCII);
                InetAddress group = InetAddress.getByName("239.255.255.250");
                sock.send(new DatagramPacket(msg, msg.length, group, 1900));
                long end = System.currentTimeMillis() + timeout;
                boolean resent = false;
                byte[] buf = new byte[2048];
                while (System.currentTimeMillis() < end) {
                    if (!resent && System.currentTimeMillis() > end - timeout + 500) {
                        sock.send(new DatagramPacket(msg, msg.length, group, 1900));
                        resent = true;
                    }
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    try {
                        sock.receive(p);
                    } catch (java.net.SocketTimeoutException e) {
                        continue;
                    }
                    String host = p.getAddress().getHostAddress();
                    String text = new String(p.getData(), 0, p.getLength(), StandardCharsets.ISO_8859_1);
                    java.util.regex.Matcher m = java.util.regex.Pattern.compile("(?im)^location:\\s*(.+)$").matcher(text);
                    if (!m.find() || !seen.add(host)) continue;
                    String xml = fetch(m.group(1).trim());
                    if (xml.isEmpty()) continue;
                    JSObject o = new JSObject();
                    o.put("host", host);
                    o.put("xml", xml);
                    out.put(o);
                }
                sock.close();
            } catch (Exception ignored) {
                /* multicast indisponible : le balayage TCP prendra le relais */
            } finally {
                if (lock != null && lock.isHeld()) lock.release();
            }
            JSObject r = new JSObject();
            r.put("responses", out);
            call.resolve(r);
        });
    }

    private String fetch(String url) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(2000);
            c.setReadTimeout(2000);
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            try (InputStream in = c.getInputStream()) {
                byte[] buf = new byte[2048];
                int n;
                while ((n = in.read(buf)) >= 0 && b.size() < 100000) b.write(buf, 0, n);
            }
            return b.toString("UTF-8");
        } catch (Exception e) {
            return "";
        }
    }
}
