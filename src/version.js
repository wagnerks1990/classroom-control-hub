"use strict";
const fs=require("fs");
const path=require("path");
function applicationVersion(root=path.resolve(__dirname,"..")){try{return fs.readFileSync(path.join(root,"VERSION"),"utf8").trim()}catch{return "unknown"}}
module.exports={applicationVersion};
