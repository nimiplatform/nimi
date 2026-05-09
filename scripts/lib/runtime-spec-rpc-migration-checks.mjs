export function checkRpcMigrationMapCoverage({ fail, fs, protoRoot, readYaml, walk }) {
  const rpcMethods = readYaml('.nimi/spec/runtime/kernel/tables/rpc-methods.yaml');
  const migration = readYaml('.nimi/spec/runtime/kernel/tables/rpc-migration-map.yaml');
  const protoMap = parseProtoServiceMethodMap({ fs, protoRoot, walk });

  const services = Array.isArray(rpcMethods?.services) ? rpcMethods.services : [];
  const serviceMethodMap = new Map();
  for (const service of services) {
    const serviceName = String(service?.name || '').trim();
    if (!serviceName) continue;
    const methods = new Set(
      (Array.isArray(service?.methods) ? service.methods : [])
        .map((m) => String(m?.name || '').trim())
        .filter(Boolean),
    );
    serviceMethodMap.set(serviceName, methods);
  }

  const serviceMappings = Array.isArray(migration?.service_mappings) ? migration.service_mappings : [];
  const methodMappings = Array.isArray(migration?.method_mappings) ? migration.method_mappings : [];
  const excludedProtoMethods = Array.isArray(migration?.excluded_proto_methods) ? migration.excluded_proto_methods : [];

  const serviceMappingByDesign = new Map();
  for (const item of serviceMappings) {
    const designService = String(item?.design_service || '').trim();
    if (!designService) {
      fail('rpc-migration-map service_mappings entry missing design_service');
      continue;
    }
    if (serviceMappingByDesign.has(designService)) {
      fail(`rpc-migration-map duplicate service mapping: ${designService}`);
      continue;
    }
    serviceMappingByDesign.set(designService, item);
  }

  for (const designService of serviceMethodMap.keys()) {
    if (!serviceMappingByDesign.has(designService)) {
      fail(`rpc-migration-map missing service mapping for ${designService}`);
    }
  }

  for (const [designService, mapping] of serviceMappingByDesign.entries()) {
    const protoService = String(mapping?.proto_service || '').trim();
    const status = String(mapping?.mapping_status || '').trim();
    const serviceMethodMappings = methodMappings.filter(
      (item) => String(item?.design_service || '').trim() === designService,
    );
    if (!protoService) {
      if (status !== 'design_only_pending_proto') {
        fail(`rpc-migration-map ${designService} has empty proto_service but status is ${status}`);
      }
      for (const item of serviceMethodMappings) {
        const designMethod = String(item?.design_method || '').trim();
        const methodProtoService = String(item?.proto_service || '').trim();
        const methodProtoName = String(item?.proto_method || '').trim();
        if (methodProtoService || methodProtoName) {
          fail(`rpc-migration-map ${designService} is design_only_pending_proto but method ${designMethod || '<unknown>'} maps to ${methodProtoService || '<empty>'}.${methodProtoName || '<empty>'}`);
        }
      }
      continue;
    }
    if (!protoMap.has(protoService)) {
      fail(`rpc-migration-map ${designService} references unknown proto service: ${protoService}`);
    }
    for (const item of serviceMethodMappings) {
      const designMethod = String(item?.design_method || '').trim();
      const methodProtoService = String(item?.proto_service || '').trim();
      if (methodProtoService && methodProtoService !== protoService) {
        fail(`rpc-migration-map ${designService}.${designMethod || '<unknown>'} maps to ${methodProtoService}, which diverges from service proto ${protoService}`);
      }
    }
  }

  const methodMappingByDesignMethod = new Map();
  for (const item of methodMappings) {
    const designService = String(item?.design_service || '').trim();
    const designMethod = String(item?.design_method || '').trim();
    if (!designService || !designMethod) {
      fail('rpc-migration-map method_mappings entry missing design_service/design_method');
      continue;
    }
    const key = `${designService}.${designMethod}`;
    if (methodMappingByDesignMethod.has(key)) {
      fail(`rpc-migration-map duplicate method mapping: ${key}`);
      continue;
    }
    methodMappingByDesignMethod.set(key, item);

    const protoService = String(item?.proto_service || '').trim();
    const protoMethod = String(item?.proto_method || '').trim();
    const status = String(item?.mapping_status || '').trim();
    if (!protoService || !protoMethod) {
      if (status !== 'planned') {
        fail(`rpc-migration-map ${key} has empty proto target but status is ${status}`);
      }
      continue;
    }
    const protoMethods = protoMap.get(protoService);
    if (!protoMethods) {
      fail(`rpc-migration-map ${key} references unknown proto service: ${protoService}`);
      continue;
    }
    if (!protoMethods.has(protoMethod)) {
      fail(`rpc-migration-map ${key} references unknown proto method: ${protoService}.${protoMethod}`);
    }
  }

  for (const [designService, methods] of serviceMethodMap.entries()) {
    for (const method of methods) {
      const key = `${designService}.${method}`;
      if (!methodMappingByDesignMethod.has(key)) {
        fail(`rpc-migration-map missing method mapping for ${key}`);
      }
    }
  }

  const excludedSet = new Set();
  for (const item of excludedProtoMethods) {
    const protoService = String(item?.proto_service || '').trim();
    const protoMethod = String(item?.proto_method || '').trim();
    if (!protoService || !protoMethod) {
      fail('rpc-migration-map excluded_proto_methods entry missing proto_service/proto_method');
      continue;
    }
    const key = `${protoService}.${protoMethod}`;
    if (excludedSet.has(key)) {
      fail(`rpc-migration-map duplicate excluded proto method: ${key}`);
      continue;
    }
    excludedSet.add(key);
    const protoMethods = protoMap.get(protoService);
    if (!protoMethods || !protoMethods.has(protoMethod)) {
      fail(`rpc-migration-map excluded proto method does not exist: ${key}`);
    }
  }

  for (const [designService, mapping] of serviceMappingByDesign.entries()) {
    const protoService = String(mapping?.proto_service || '').trim();
    if (!protoService) continue;
    const protoMethods = protoMap.get(protoService);
    if (!protoMethods) continue;

    const mappedProtoMethods = new Set();
    for (const item of methodMappings) {
      const serviceName = String(item?.design_service || '').trim();
      const methodProtoService = String(item?.proto_service || '').trim();
      const methodProtoName = String(item?.proto_method || '').trim();
      if (serviceName !== designService) continue;
      if (!methodProtoService || !methodProtoName) continue;
      mappedProtoMethods.add(methodProtoName);
    }

    const status = String(mapping?.mapping_status || '').trim();
    for (const protoMethod of protoMethods) {
      if (mappedProtoMethods.has(protoMethod)) continue;
      if (status === 'aligned') {
        fail(`rpc-migration-map aligned service ${designService} leaves proto method unmapped: ${protoService}.${protoMethod}`);
        continue;
      }
      const excludedKey = `${protoService}.${protoMethod}`;
      if (!excludedSet.has(excludedKey)) {
        fail(`rpc-migration-map missing excluded_proto_methods entry for ${excludedKey}`);
      }
    }
  }
}

function parseProtoServiceMethodMap({ fs, protoRoot, walk }) {
  const out = new Map();
  const files = walk(protoRoot).filter((p) => p.endsWith('.proto'));
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    let currentService = '';
    let braceDepth = 0;
    for (const line of lines) {
      const serviceMatch = line.match(/^\s*service\s+([A-Za-z0-9_]+)\s*\{/u);
      if (serviceMatch) {
        currentService = serviceMatch[1];
        braceDepth = 1;
        if (!out.has(currentService)) out.set(currentService, new Set());
        continue;
      }
      if (currentService) {
        const rpcMatch = line.match(/^\s*rpc\s+([A-Za-z0-9_]+)\s*\(/u);
        if (rpcMatch) {
          out.get(currentService)?.add(rpcMatch[1]);
        }
        for (const ch of line) {
          if (ch === '{') braceDepth++;
          else if (ch === '}') braceDepth--;
        }
        if (braceDepth <= 0) {
          currentService = '';
          braceDepth = 0;
        }
      }
    }
  }
  return out;
}
