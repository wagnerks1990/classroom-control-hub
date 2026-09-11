package org.roomgoblin.display;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

final class HubStorage {
    private static final String NAME="classroom_hub";
    private HubStorage() {}

    static SharedPreferences prefs(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            Context device=context.createDeviceProtectedStorageContext();
            try { device.moveSharedPreferencesFrom(context,NAME); } catch (Exception ignored) {}
            return device.getSharedPreferences(NAME,Context.MODE_PRIVATE);
        }
        return context.getSharedPreferences(NAME,Context.MODE_PRIVATE);
    }
}
