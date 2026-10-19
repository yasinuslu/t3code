const http=require("http");http.createServer((q,r)=>r.end("hello from "+require("os").hostname()+"\n")).listen(4321);
