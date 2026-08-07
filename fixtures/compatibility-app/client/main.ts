async function runCompatibilityChecks() {
  const json = await fetch("/api/json");
  console.log("json", await json.json());

  const stream = await fetch("/stream");
  const reader = stream.body?.getReader();

  if (reader) {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      console.log(new TextDecoder().decode(result.value));
    }
  }

  const echo = await fetch("/api/echo", {
    method: "POST",
    body: "hello scramjet-ng",
  });

  console.log("echo", await echo.json());
}

runCompatibilityChecks().catch(console.error);
