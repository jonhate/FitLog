package com.jon.fitlog;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "FitLogFiles")
public class FitLogFilesPlugin extends Plugin {
    private static final int MAX_BYTES = 25 * 1024 * 1024;

    @PluginMethod
    public void migrationBackup(PluginCall call) {
        try {
            java.io.File file = new java.io.File(getContext().getFilesDir(), "FitLog-pre-migration.json");
            java.io.File temp = new java.io.File(getContext().getFilesDir(), "FitLog-pre-migration.tmp");
            String text = call.getString("text");
            if (text == null) throw new Exception("缺少备份内容");
            try (java.io.FileOutputStream out = new java.io.FileOutputStream(temp)) {
                out.write(text.getBytes(StandardCharsets.UTF_8)); out.flush(); out.getFD().sync();
            }
            if (!temp.renameTo(file)) throw new Exception("无法提交备份文件");
            call.resolve();
        } catch (Exception error) { call.reject("迁移前备份失败：" + error.getMessage()); }
    }

    @PluginMethod
    public void save(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            call.reject("文件为空或超过25MB限制"); return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mime", "application/json"));
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("name", "FitLog.json"));
        startActivityForResult(call, intent, "saved");
    }

    @ActivityCallback
    private void saved(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject out = new JSObject(); out.put("saved", false); call.resolve(out); return;
        }
        Uri uri = result.getData().getData();
        if (uri == null) { call.reject("系统未返回保存位置"); return; }
        getBridge().execute(() -> {
            try (OutputStream stream = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (stream == null) throw new Exception("无法写入文件");
                byte[] bytes = call.getString("text", "").getBytes(StandardCharsets.UTF_8);
                stream.write(bytes); stream.flush();
            } catch (Exception error) { call.reject("写入失败：" + error.getMessage()); return; }
            // Reopen and compare bytes: success is reported only after the public document was written.
            try (InputStream stream = getContext().getContentResolver().openInputStream(uri)) {
                if (stream == null) throw new Exception("无法复核保存文件");
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] chunk = new byte[8192]; int n;
                while ((n = stream.read(chunk)) != -1) { buffer.write(chunk, 0, n); if (buffer.size() > MAX_BYTES) throw new Exception("文件过大"); }
                if (!java.util.Arrays.equals(buffer.toByteArray(), call.getString("text", "").getBytes(StandardCharsets.UTF_8))) throw new Exception("保存内容校验失败");
                JSObject out = new JSObject(); out.put("saved", true); call.resolve(out);
            } catch (Exception error) { call.reject("写入后校验失败：" + error.getMessage()); }
        });
    }

    @PluginMethod
    public void open(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        startActivityForResult(call, intent, "opened");
    }

    @ActivityCallback
    private void opened(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("已取消文件选择"); return;
        }
        Uri uri = result.getData().getData();
        getBridge().execute(() -> {
            try (InputStream stream = getContext().getContentResolver().openInputStream(uri)) {
                if (stream == null) throw new Exception("无法打开文件");
                ByteArrayOutputStream buffer = new ByteArrayOutputStream(); byte[] chunk = new byte[8192]; int n;
                while ((n = stream.read(chunk)) != -1) { buffer.write(chunk, 0, n); if (buffer.size() > MAX_BYTES) throw new Exception("备份超过25MB"); }
                JSObject out = new JSObject(); out.put("text", new String(buffer.toByteArray(), StandardCharsets.UTF_8)); call.resolve(out);
            } catch (Exception error) { call.reject("读取失败：" + error.getMessage()); }
        });
    }
}
