package fr.pioneerremote.app;

import android.os.Bundle;
import android.view.KeyEvent;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** Activé depuis la WebView (option « Boutons de volume du téléphone », ampli connecté). */
    static volatile boolean volumeKeys = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PioneerNetPlugin.class);
        super.onCreate(savedInstanceState);
    }

    // Les boutons de volume règlent l'ampli au lieu du téléphone ; un appui maintenu se répète comme sur la télécommande.
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (volumeKeys && bridge != null && (code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN)) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                String dir = code == KeyEvent.KEYCODE_VOLUME_UP ? "up" : "down";
                bridge.triggerWindowJSEvent("pioneerVolumeKey", "{\"dir\":\"" + dir + "\"}");
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
}
