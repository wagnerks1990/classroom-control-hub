"use strict";

function addKyleAttribution(){
  if(document.querySelector("[data-kyle-attribution]"))return;
  const footer=document.createElement("footer");
  const renderer=/\/(display|document-viewer|antmedia-player)(\/|$)/.test(location.pathname);
  footer.className=`app-attribution${renderer?" app-attribution--overlay":""}`;
  footer.dataset.kyleAttribution="true";
  footer.append("Built by ");
  const link=document.createElement("a");
  link.href="https://github.com/wagnerks1990";
  link.target="_blank";
  link.rel="author noopener noreferrer";
  link.textContent="Kyle Wagner";
  footer.append(link);
  document.body.append(footer);
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",addKyleAttribution,{once:true});
else addKyleAttribution();

