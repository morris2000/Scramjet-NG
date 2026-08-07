import http from "node:http";

const server = http.createServer(async (req, res) => {
  if (req.url === "/api/json") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.url === "/stream") {
    res.writeHead(200, {
      "content-type": "text/plain",
      "transfer-encoding": "chunked",
    });

    res.write("chunk-1\n");
    setTimeout(() => res.write("chunk-2\n"), 100);
    setTimeout(() => res.end("chunk-3\n"), 200);
    return;
  }

  if (req.url === "/api/echo" && req.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }

    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ body: Buffer.concat(chunks).toString() }));
    return;
  }

  res.setHeader("content-type", "text/html");
  res.end("<!doctype html><html><body><div id=app>Scramjet-NG Fixture</div><script src=/main.js></script></body></html>");
});

server.listen(3000, () => {
  console.log("fixture listening on http://localhost:3000");
});
