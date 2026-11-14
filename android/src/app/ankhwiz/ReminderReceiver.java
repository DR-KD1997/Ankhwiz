// The daily reminder. An alarm wakes this receiver at the chosen time; it
// posts a notification only on a chosen day of the week, and only when
// nothing has been studied yet today. It then sets the alarm for the next
// day. After the phone restarts, the alarm is set again.
//
// Everything it needs (on or off, the time, the days, the text, the last day
// studied) is kept in preferences by the interface through MainActivity.

package app.ankhwiz;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import java.util.Calendar;
import java.util.TimeZone;

public class ReminderReceiver extends BroadcastReceiver {
    static final String PREFS = "reminder";
    static final String ACTION = "app.ankhwiz.REMINDER";
    private static final String CHANNEL = "daily-reminder";

    @Override
    public void onReceive(Context context, Intent intent) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (ACTION.equals(intent.getAction()) && p.getBoolean("on", false)) {
            Calendar now = Calendar.getInstance();
            int weekday = now.get(Calendar.DAY_OF_WEEK) - 1; // 0 = Sunday, as in the interface
            boolean dayChosen = ("," + p.getString("days", "0,1,2,3,4,5,6") + ",").contains("," + weekday + ",");
            if (dayChosen && p.getLong("studied", -1) != today()) notify(context, p.getString("text", "Your next lesson is ready."));
        }
        schedule(context);
    }

    /** Today as a local day number, the same count the interface uses. */
    static long today() {
        long now = System.currentTimeMillis();
        long local = now + TimeZone.getDefault().getOffset(now);
        long day = local / 86_400_000L;
        return local < 0 && local % 86_400_000L != 0 ? day - 1 : day;
    }

    /** Set (or cancel) the alarm for the next time the reminder may come. */
    static void schedule(Context context) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        Intent intent = new Intent(context, ReminderReceiver.class).setAction(ACTION);
        PendingIntent pending = PendingIntent.getBroadcast(context, 1, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        alarms.cancel(pending);
        if (!p.getBoolean("on", false)) return;
        Calendar at = Calendar.getInstance();
        at.set(Calendar.HOUR_OF_DAY, p.getInt("hour", 19));
        at.set(Calendar.MINUTE, p.getInt("minute", 30));
        at.set(Calendar.SECOND, 0);
        at.set(Calendar.MILLISECOND, 0);
        if (at.getTimeInMillis() <= System.currentTimeMillis() + 1000) at.add(Calendar.DAY_OF_MONTH, 1);
        // Not exact to the minute: Android may group it with other alarms to save battery.
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at.getTimeInMillis(), pending);
    }

    @SuppressWarnings("deprecation")
    private static void notify(Context context, String text) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= 26) {
            // Notification channels (Android 8) are newer than the library this app is built with,
            // so they are reached by name.
            try {
                Class<?> channelClass = Class.forName("android.app.NotificationChannel");
                Object channel = channelClass.getConstructor(String.class, CharSequence.class, int.class)
                        .newInstance(CHANNEL, "Daily reminder", 3 /* IMPORTANCE_DEFAULT */);
                NotificationManager.class.getMethod("createNotificationChannel", channelClass).invoke(manager, channel);
                builder = Notification.Builder.class.getConstructor(Context.class, String.class).newInstance(context, CHANNEL);
            } catch (Exception e) {
                builder = new Notification.Builder(context);
            }
        } else {
            builder = new Notification.Builder(context);
        }
        Intent open = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, 2, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        builder.setSmallIcon(context.getApplicationInfo().icon)
                .setContentTitle("Ankhwiz")
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setContentIntent(tap)
                .setAutoCancel(true);
        try {
            manager.notify(1, builder.build());
        } catch (SecurityException e) {
            // Notifications are turned off for the app; nothing to show.
        }
    }
}
