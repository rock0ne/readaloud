<#
  ReadAloud for Windows: serves the built app on http://127.0.0.1:<Port>/ and opens it in
  Microsoft Edge (ADR-29). Uses only what Windows 10 and 11 already have: Windows PowerShell 5.1
  and the .NET Framework. No Node, no admin rights, nothing installed, nothing sent anywhere:
  it listens on this PC only (127.0.0.1).

  Keep the window open while you use the app; close it to stop. Once ReadAloud is installed
  from Edge, it also opens from its own icon while this window is closed.
#>
param(
  # The built app (the folder with index.html).
  [string]$Root = (Join-Path $PSScriptRoot 'app'),
  # Always the same port: the browser keeps each address's library and flags apart.
  [int]$Port = 4173,
  # Open the app in Edge once the server runs.
  [switch]$Open
)

$ErrorActionPreference = 'Stop'
$url = "http://127.0.0.1:$Port/"

function Open-App {
  try { Start-Process -FilePath 'msedge.exe' -ArgumentList $url }
  catch { Start-Process -FilePath $url }
}

if (-not (Test-Path -LiteralPath (Join-Path $Root 'index.html'))) {
  Write-Host "ReadAloud's files were not found in $Root (index.html is missing)."
  exit 1
}
$Root = (Resolve-Path -LiteralPath $Root).Path

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace ReadAloud {
  // A small static file server for one folder, on the loopback address only.
  public static class StaticServer {
    static readonly Dictionary<string, string> Types = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
      { ".html", "text/html; charset=utf-8" },
      { ".js", "text/javascript; charset=utf-8" },
      { ".mjs", "text/javascript; charset=utf-8" },
      { ".css", "text/css; charset=utf-8" },
      { ".json", "application/json; charset=utf-8" },
      { ".webmanifest", "application/manifest+json; charset=utf-8" },
      { ".wasm", "application/wasm" },
      { ".svg", "image/svg+xml" },
      { ".png", "image/png" },
      { ".ico", "image/x-icon" },
      { ".txt", "text/plain; charset=utf-8" },
      { ".map", "application/json; charset=utf-8" }
    };

    public static TcpListener Start(string root, int port) {
      // The same form Resolve compares against: GetFullPath also expands 8.3 names (PROGRA~1).
      root = Path.GetFullPath(root);
      TcpListener listener = new TcpListener(IPAddress.Loopback, port);
      listener.ExclusiveAddressUse = true;
      listener.Start();
      Thread accept = new Thread(delegate () { Accept(listener, root); });
      accept.IsBackground = true;
      accept.Start();
      return listener;
    }

    static void Accept(TcpListener listener, string root) {
      while (true) {
        TcpClient client;
        try { client = listener.AcceptTcpClient(); } catch { return; }
        ThreadPool.QueueUserWorkItem(delegate (object state) { Handle(client, root); });
      }
    }

    static void Handle(TcpClient client, string root) {
      using (client) {
        try {
          client.ReceiveTimeout = 15000;
          client.SendTimeout = 60000;
          NetworkStream stream = client.GetStream();
          string head = ReadHead(stream);
          if (head == null) return;
          string[] lines = head.Split(new[] { "\r\n" }, StringSplitOptions.None);
          string[] request = lines[0].Split(' ');
          if (request.Length < 3) { Send(stream, 400, "Bad Request", null, null, false); return; }
          string method = request[0];
          Dictionary<string, string> headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
          for (int i = 1; i < lines.Length; i++) {
            int colon = lines[i].IndexOf(':');
            if (colon > 0) headers[lines[i].Substring(0, colon).Trim()] = lines[i].Substring(colon + 1).Trim();
          }
          if (method != "GET" && method != "HEAD") { Send(stream, 405, "Method Not Allowed", null, null, false); return; }
          string file = Resolve(root, request[1]);
          if (file == null) { Send(stream, 404, "Not Found", null, null, method == "HEAD"); return; }
          SendFile(stream, file, headers, method == "HEAD");
        } catch (IOException) {
        } catch (SocketException) {
        } catch (ObjectDisposedException) {
        }
      }
    }

    // The request head, up to the blank line; null if the browser closed or sent nothing.
    static string ReadHead(NetworkStream stream) {
      MemoryStream buffer = new MemoryStream();
      int matched = 0;
      while (buffer.Length < 32768) {
        int b = stream.ReadByte();
        if (b < 0) return null;
        buffer.WriteByte((byte)b);
        matched = (b == (matched % 2 == 0 ? '\r' : '\n')) ? matched + 1 : (b == '\r' ? 1 : 0);
        if (matched == 4) return Encoding.ASCII.GetString(buffer.ToArray(), 0, (int)buffer.Length - 4);
      }
      return null;
    }

    // The file for a URL path inside root, index.html for folders and for app routes, or null.
    static string Resolve(string root, string target) {
      string path = target;
      int cut = path.IndexOfAny(new[] { '?', '#' });
      if (cut >= 0) path = path.Substring(0, cut);
      path = Uri.UnescapeDataString(path).Replace('/', Path.DirectorySeparatorChar).TrimStart(Path.DirectorySeparatorChar);
      string full;
      try { full = Path.GetFullPath(Path.Combine(root, path)); } catch { return null; }
      string rootWithSlash = root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
      if (!full.Equals(root.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase) &&
          !full.StartsWith(rootWithSlash, StringComparison.OrdinalIgnoreCase)) return null;
      if (Directory.Exists(full)) full = Path.Combine(full, "index.html");
      if (File.Exists(full)) return full;
      return Path.HasExtension(full) ? null : Path.Combine(root, "index.html");
    }

    static void SendFile(NetworkStream stream, string file, Dictionary<string, string> headers, bool headOnly) {
      FileInfo info = new FileInfo(file);
      DateTime modified = info.LastWriteTimeUtc;
      modified = new DateTime(modified.Year, modified.Month, modified.Day, modified.Hour, modified.Minute, modified.Second, DateTimeKind.Utc);
      string lastModified = modified.ToString("r", CultureInfo.InvariantCulture);
      string since;
      if (headers.TryGetValue("If-Modified-Since", out since) && since == lastModified) {
        Send(stream, 304, "Not Modified", null, lastModified, true);
        return;
      }
      string type;
      if (!Types.TryGetValue(info.Extension, out type)) type = "application/octet-stream";
      StringBuilder head = Head(200, "OK", type, info.Length, lastModified);
      byte[] bytes = Encoding.ASCII.GetBytes(head.ToString());
      stream.Write(bytes, 0, bytes.Length);
      if (headOnly) return;
      using (FileStream input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) {
        input.CopyTo(stream, 65536);
      }
      stream.Flush();
    }

    static void Send(NetworkStream stream, int code, string reason, string type, string lastModified, bool headOnly) {
      byte[] body = Encoding.UTF8.GetBytes(code == 304 ? "" : reason + "\n");
      StringBuilder head = Head(code, reason, type ?? "text/plain; charset=utf-8", code == 304 ? -1 : body.Length, lastModified);
      byte[] bytes = Encoding.ASCII.GetBytes(head.ToString());
      stream.Write(bytes, 0, bytes.Length);
      if (!headOnly && code != 304) stream.Write(body, 0, body.Length);
      stream.Flush();
    }

    // The headers the app needs: cross-origin isolation lets the Kokoro voice use several
    // threads; 'credentialless' still allows the model download from Hugging Face (ADR-22).
    static StringBuilder Head(int code, string reason, string type, long length, string lastModified) {
      StringBuilder head = new StringBuilder();
      head.Append("HTTP/1.1 ").Append(code).Append(' ').Append(reason).Append("\r\n");
      if (code != 304) head.Append("Content-Type: ").Append(type).Append("\r\n");
      if (length >= 0) head.Append("Content-Length: ").Append(length).Append("\r\n");
      if (lastModified != null) head.Append("Last-Modified: ").Append(lastModified).Append("\r\n");
      head.Append("Cache-Control: no-cache\r\n");
      head.Append("Cross-Origin-Opener-Policy: same-origin\r\n");
      head.Append("Cross-Origin-Embedder-Policy: credentialless\r\n");
      head.Append("X-Content-Type-Options: nosniff\r\n");
      head.Append("Connection: close\r\n\r\n");
      return head;
    }
  }
}
'@

try {
  $listener = [ReadAloud.StaticServer]::Start($Root, $Port)
} catch {
  # Another window may already be serving ReadAloud on this port: then just open it.
  $running = $false
  try {
    $page = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
    $running = $page.Content -match 'ReadAloud'
  } catch { }
  if ($running) {
    Write-Host "ReadAloud is already running at $url"
    if ($Open) { Open-App }
    exit 0
  }
  Write-Host "Port $Port is in use by another program, so ReadAloud cannot start."
  exit 1
}

Write-Host "ReadAloud is running at $url"
Write-Host 'Keep this window open while you use it. Close the window to stop ReadAloud.'
if ($Open) { Open-App }
try {
  while ($true) { Start-Sleep -Seconds 1 }
} finally {
  $listener.Stop()
}
