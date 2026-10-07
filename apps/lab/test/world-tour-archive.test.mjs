import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { zipSync } from 'fflate';
const result = await build({entryPoints:[new URL('../src/lab/world-tour/world-tour-archive.ts',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {parseWorldTourArchive}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
function archive(metadata){return zipSync({'world.json':new TextEncoder().encode(JSON.stringify(metadata)),'world.spz':new Uint8Array([1,2,3])});}
test('archive preserves complete calibrated metadata and explicit uncalibrated format without metric defaults',()=>{
 const calibrated={displayName:'Original Marble',splatCoordinateSystem:'opencv',metricScaleFactor:2,groundPlaneOffset:0,splatPath:'world.spz'};
 const old=archive(calibrated);const before=old.slice();const parsed=parseWorldTourArchive(old);
 assert.equal(parsed.calibrationState,'calibrated');assert.equal(parsed.metricScaleFactor,2);assert.equal(parsed.groundPlaneOffset,0);assert.deepEqual(old,before);
 const native={displayName:'Native scene',calibrationState:'uncalibrated',splatCoordinateSystem:'spz-rub',splatPath:'world.spz'};
 const scene=parseWorldTourArchive(archive(native));assert.equal(scene.calibrationState,'uncalibrated');assert.equal(scene.splatCoordinateSystem,'spz-rub');assert.ok(!('metricScaleFactor' in scene));assert.ok(!('groundPlaneOffset' in scene));
 for(const value of [{...native,metricScaleFactor:1},{...native,groundPlaneOffset:0},{...native,calibrationState:'guess'},{...calibrated,metricScaleFactor:undefined},{...calibrated,groundPlaneOffset:undefined},{...native,splatCoordinateSystem:'guess'}])assert.throws(()=>parseWorldTourArchive(archive(value)),/metadata-invalid/);
});
