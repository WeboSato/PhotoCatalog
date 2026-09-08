// Contrat XMP : drapeau, copyright et unités Adobe survivent un aller-retour.
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const B = '/private/tmp/claude-501/-Volumes-Seagate-4T-PhotoCatalog/745e7b21-9f4b-40fc-ab1c-b46439395bf0/scratchpad/xmp-round';
let pass=0, fail=0;
const ck=(n,ok,x='')=>{console.log(`${ok?'✅':'❌'} ${n}${x?' — '+x:''}`); ok?pass++:fail++;};
app.whenReady().then(() => {
  const { XmpService } = require('/Volumes/Seagate 4T/PhotoCatalog/dist/main/main/services/XmpService.js');
  fs.rmSync(B,{recursive:true,force:true}); fs.mkdirSync(B,{recursive:true});

  // getXmpPath : extension en fin de nom uniquement
  const weird = path.join(B,'photo.jpg copie.jpg');
  ck('getXmpPath ne casse pas un nom contenant .jpg', XmpService.getXmpPath(weird) === path.join(B,'photo.jpg copie.xmp'),
     path.basename(XmpService.getXmpPath(weird)));

  // aller-retour drapeau + copyright
  const img = path.join(B,'a.NEF'); fs.writeFileSync(img,'x');
  XmpService.writeXmp(img,{rating:4,flag:'rejected',copyright:'© Martin Paquette',keywords:['test']});
  const back = XmpService.readXmp(img);
  ck('drapeau rejeté écrit puis relu', back.flag === 'rejected', String(back.flag));
  ck('copyright conservé', back.copyright === '© Martin Paquette', String(back.copyright));

  XmpService.updateXmp(img,{rating:5});
  const back2 = XmpService.readXmp(img);
  ck('copyright survit un updateXmp (dc:rights)', back2.copyright === '© Martin Paquette');
  ck('drapeau survit un updateXmp', back2.flag === 'rejected');

  // unités Adobe : un sidecar ACR en Kelvin ne doit pas polluer les curseurs
  const acr = path.join(B,'b.NEF'); fs.writeFileSync(acr,'x');
  fs.writeFileSync(XmpService.getXmpPath(acr),
    '<?xpacket begin=""?><x:xmpmeta x:xmptk="Adobe XMP Core"><rdf:RDF><rdf:Description crs:Temperature="5150" crs:Tint="12" crs:Exposure2012="0.5"/></rdf:RDF></x:xmpmeta>');
  const adobe = XmpService.readXmp(acr);
  ck('Kelvin Adobe ignoré (pas injecté dans un curseur ±100)', !adobe.develop || adobe.develop.temperature === undefined,
     'temperature='+(adobe.develop&&adobe.develop.temperature));
  console.log(`\n${pass}/${pass+fail} tests OK`);
  app.exit(fail===0?0:1);
}).catch(e=>{console.error(e);app.exit(1);});
