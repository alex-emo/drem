package cn.pum.dream;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.security.MessageDigest;

@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {
    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("缺少下载地址");
            return;
        }
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + context.getPackageName())
            );
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(settings);
            call.reject("请允许 Dream 安装未知应用后重试");
            return;
        }

        String fileName = "dream-update.apk";
        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
        request.setTitle("Dream 更新");
        request.setMimeType("application/vnd.android.package-archive");
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        request.setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, fileName);
        long downloadId = manager.enqueue(request);

        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                long completed = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (completed != downloadId) return;
                ctx.unregisterReceiver(this);
                File apk = new File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), fileName);
                if (!apk.exists()) {
                    call.reject("安装包下载失败");
                    return;
                }
                String expected = call.getString("sha256");
                if (expected != null && !expected.isEmpty()) {
                    try {
                        String actual = sha256(apk);
                        if (!expected.equalsIgnoreCase(actual)) {
                            // 校验不通过时删除残缺/被篡改的包，避免误装与重复使用。
                            apk.delete();
                            call.reject("安装包校验失败，请重新下载");
                            return;
                        }
                    } catch (Exception exception) {
                        call.reject("安装包校验失败，请重新下载");
                        return;
                    }
                }
                Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
                Intent install = new Intent(Intent.ACTION_VIEW);
                install.setDataAndType(uri, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(install);
                JSObject result = new JSObject();
                result.put("ok", true);
                call.resolve(result);
            }
        };
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), Context.RECEIVER_EXPORTED);
        } else {
            context.registerReceiver(receiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
        }
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        StringBuilder out = new StringBuilder();
        for (byte value : digest.digest()) {
            out.append(String.format("%02x", value));
        }
        return out.toString();
    }
}
