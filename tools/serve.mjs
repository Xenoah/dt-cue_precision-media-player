import http from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../site');
const args=process.argv.slice(2),port=Number(args[args.indexOf('--port')+1])||Number(process.env.PORT)||4173;
const host=args.includes('--host')?args[args.indexOf('--host')+1]:'0.0.0.0';
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.zip':'application/zip','.wav':'audio/wav','.mp4':'video/mp4','.webm':'video/webm'};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');let target=decodeURIComponent(url.pathname);if(target.endsWith('/'))target+='index.html';
    const filename=path.resolve(root,'.'+target);if(!filename.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    const info=await stat(filename);if(!info.isFile())throw new Error('Not a file');
    const headers={'Content-Type':types[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'};
    if(req.headers.range){const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!match){res.writeHead(416);res.end();return;}
      const start=Number(match[1]),end=Math.min(info.size-1,match[2]?Number(match[2]):info.size-1);
      if(start>end){res.writeHead(416,{'Content-Range':`bytes */${info.size}`});res.end();return;}
      res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${info.size}`,'Content-Length':end-start+1});createReadStream(filename,{start,end}).pipe(res);
    }else{res.writeHead(200,{...headers,'Content-Length':info.size});if(req.method==='HEAD')res.end();else createReadStream(filename).pipe(res);}
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(port,host,()=>console.log(`dt-cue ready: http://localhost:${port}`));
