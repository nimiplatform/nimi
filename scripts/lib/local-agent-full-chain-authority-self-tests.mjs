import YAML from 'yaml';
import {
  consumerRequirements,
  conversationReportRequirements,
  expectedTraceabilityMappings,
  governingRelation,
  markdownOwner,
  ownerPaths,
  runtimeRequirements,
  yamlOwner,
} from './local-agent-full-chain-authority-model.mjs';

export function runAuthorityAdversarialSelfTests(checker) {
  const {
    consumerAuthorityFindings,
    extractCompactRuleIds,
    findYamlRecord,
    inverseActive,
    inversePassive,
    ownerLabel,
    parseMarkdownRules,
    parseTraceabilityRows,
    parseYamlRecords,
    relationEquals,
    relationRecordString,
    requiredActive,
    runtimeAuthorityFindings,
    sameOrderedValues,
  } = checker;

function selfTestDocument(relPath, text, kind = 'markdown') {
  const document = { relPath, text, kind };
  if (kind === 'markdown') {
    document.rules = parseMarkdownRules(document);
  } else {
    const parsedYaml = parseYamlRecords(document);
    document.parsed = parsedYaml.parsed;
    document.records = parsedYaml.records;
  }
  return document;
}

function assertSelfTest(condition, message) {
  if (!condition) throw new Error(`adversarial self-test: ${message}`);
}

function buildFixtureDocuments(requirements, extras = [], additionalDocuments = []) {
  const markdownBuckets = new Map();
  const yamlBuckets = new Map();

  function addRelation(owner, relation) {
    if (owner.kind === 'markdown') {
      if (!markdownBuckets.has(owner.relPath)) markdownBuckets.set(owner.relPath, new Map());
      const rules = markdownBuckets.get(owner.relPath);
      if (!rules.has(owner.ruleId)) rules.set(owner.ruleId, []);
      rules.get(owner.ruleId).push(relation);
      return;
    }
    if (!yamlBuckets.has(owner.relPath)) yamlBuckets.set(owner.relPath, new Map());
    const records = yamlBuckets.get(owner.relPath);
    const recordKey = `${owner.field}=${owner.value}`;
    if (!records.has(recordKey)) records.set(recordKey, { owner, relations: [] });
    records.get(recordKey).relations.push(relation);
  }

  for (const requirementEntry of requirements) {
    for (const owner of requirementEntry.owners) addRelation(owner, requiredActive(requirementEntry.relation));
  }
  for (const extra of extras) addRelation(extra.owner, extra.relation);

  const documents = [];
  for (const [relPath, rules] of markdownBuckets) {
    const text = [...rules]
      .map(([ruleId, relations]) => (
        `## ${ruleId} Fixture\n\n${relations.map((relation) => `- ${relationRecordString(relation)}`).join('\n')}`
      ))
      .join('\n\n');
    documents.push(selfTestDocument(relPath, text));
  }
  for (const [relPath, records] of yamlBuckets) {
    const rows = [...records.values()].map(({ owner, relations }) => ({
      [owner.field]: owner.value,
      authority_relations: relations,
    }));
    documents.push(selfTestDocument(relPath, YAML.stringify({ records: rows }), 'yaml'));
  }
  documents.push(...additionalDocuments);
  documents.sort((left, right) => left.relPath.localeCompare(right.relPath, 'en'));
  return documents;
}

function correctDesktopMachineDocument() {
  return selfTestDocument(
    ownerPaths.desktopSourceActions,
    'machine_id: desktop_realm_source_local_materialization_action_model\n',
    'yaml',
  );
}

function findingHasId(findings, id) {
  return findings.some((finding) => finding.includes(` ${id} `) || finding.includes(` ${id}-INV `));
}

function wrongMarkdownOwner(requirementEntry) {
  const relPath = requirementEntry.id.startsWith('LAHC-R')
    ? ownerPaths.runtimeService
    : ownerPaths.platformAgentCenter;
  return markdownOwner(relPath, `FIXTURE-${requirementEntry.id}`);
}

function wrongYamlOwner(requirementEntry) {
  const relPath = requirementEntry.id.startsWith('LAHC-R')
    ? '.nimi/spec/runtime/kernel/tables/local-agent-authority-relations.yaml'
    : ownerPaths.platformKitRegistry;
  return yamlOwner(relPath, 'id', `fixture.wrong-owner.${requirementEntry.id.toLowerCase()}`);
}

function hasExactInverseFinding(findings, requirementEntry, owner, relation) {
  const suffix = `: ${relationRecordString(relation)}`;
  if (owner.kind === 'yaml') {
    return findings.some((finding) => (
      finding.includes(` ${requirementEntry.id}-INV contradictory relation at ${ownerLabel(owner)}`)
      && finding.endsWith(suffix)
    ));
  }
  return findings.some((finding) => (
    finding.includes(` ${requirementEntry.id}-INV contradictory relation at ${owner.relPath}:`)
    && finding.endsWith(`#${owner.ruleId}${suffix}`)
  ));
}

function runRelationFixtureSuite(requirements, findingsFn, additionalDocuments = []) {
  const baseline = buildFixtureDocuments(requirements, [], additionalDocuments);
  const baselineFindings = findingsFn(baseline);
  assertSelfTest(
    baselineFindings.length === 0,
    `complete canonical relation fixture must be green: ${baselineFindings.join(' | ')}`,
  );

  for (const requirementEntry of requirements) {
    const admittedOwner = requirementEntry.owners[0];
    const activeInverse = inverseActive(requirementEntry.relation);
    const passiveInverse = inversePassive(requirementEntry.relation);
    const admittedActiveFixture = buildFixtureDocuments(requirements, [{
      owner: admittedOwner,
      relation: activeInverse,
    }], additionalDocuments);
    const admittedActiveFindings = findingsFn(admittedActiveFixture);
    assertSelfTest(
      hasExactInverseFinding(admittedActiveFindings, requirementEntry, admittedOwner, activeInverse),
      `${requirementEntry.id} admitted-owner active inverse must produce exact inverse finding`,
    );

    const admittedPassiveFixture = buildFixtureDocuments(requirements, [{
      owner: admittedOwner,
      relation: passiveInverse,
    }], additionalDocuments);
    const admittedPassiveFindings = findingsFn(admittedPassiveFixture);
    assertSelfTest(
      hasExactInverseFinding(admittedPassiveFindings, requirementEntry, admittedOwner, passiveInverse),
      `${requirementEntry.id} admitted-owner passive inverse must produce exact inverse finding`,
    );

    const wrongActiveOwner = wrongMarkdownOwner(requirementEntry);
    const wrongActiveFixture = buildFixtureDocuments(requirements, [{
      owner: wrongActiveOwner,
      relation: activeInverse,
    }], additionalDocuments);
    const wrongActiveFindings = findingsFn(wrongActiveFixture);
    assertSelfTest(
      hasExactInverseFinding(wrongActiveFindings, requirementEntry, wrongActiveOwner, activeInverse),
      `${requirementEntry.id} wrong-rule active inverse must produce exact inverse finding`,
    );

    const wrongPassiveOwner = wrongYamlOwner(requirementEntry);
    const wrongPassiveFixture = buildFixtureDocuments(requirements, [{
      owner: wrongPassiveOwner,
      relation: passiveInverse,
    }], additionalDocuments);
    const wrongPassiveFindings = findingsFn(wrongPassiveFixture);
    assertSelfTest(
      hasExactInverseFinding(wrongPassiveFindings, requirementEntry, wrongPassiveOwner, passiveInverse),
      `${requirementEntry.id} wrong-row passive inverse must produce exact inverse finding`,
    );
  }
}

function runValidDenialFixtures() {
  const runtimeDenials = [
    {
      owner: runtimeRequirements.find((entry) => entry.id === 'LAHC-R009').owners[0],
      relation: requiredActive(governingRelation('runtime', 'reject', 'desktop-attached-localagent-turn-context', 'denied', 'forbid', 'rejected-by', { value: 'allowed' })),
    },
    {
      owner: runtimeRequirements.find((entry) => entry.id === 'LAHC-R024').owners[0],
      relation: requiredActive(governingRelation('runtime', 'reject', 'request-deriving-source-authority-from-app-metadata', 'denied', 'forbid', 'rejected-by', { value: 'allowed' })),
    },
    {
      owner: runtimeRequirements.find((entry) => entry.id === 'LAHC-R021').owners[0],
      relation: requiredActive(governingRelation('runtime', 'reject', 'raw-public-localagent-prompt', 'denied', 'forbid', 'rejected-by', { value: 'allowed' })),
    },
  ];
  const runtimeFixture = buildFixtureDocuments(runtimeRequirements, runtimeDenials);
  assertSelfTest(
    runtimeAuthorityFindings(runtimeFixture).every((finding) => !finding.includes('-INV')),
    'valid Runtime reject/derives/raw denials must produce zero inverse findings',
  );

  const consumerDenials = [
    {
      owner: consumerRequirements.find((entry) => entry.id === 'LAHC-C001').owners[0],
      relation: requiredActive(governingRelation('sdk', 'reject', 'unbounded-localagent-source-status', 'denied', 'forbid', 'rejected-by', { value: 'allowed' })),
    },
    {
      owner: consumerRequirements.find((entry) => entry.id === 'LAHC-C001').owners[0],
      relation: requiredActive(governingRelation('sdk', 'expose', 'raw-localagent-source-status', 'denied', 'forbid', 'exposed-by', { value: 'allowed' })),
    },
    {
      owner: consumerRequirements.find((entry) => entry.id === 'LAHC-C012').owners[0],
      relation: requiredActive(governingRelation('sdk', 'reject', 'request-assembling-localagent-prompts', 'denied', 'forbid', 'rejected-by', { value: 'allowed' })),
    },
  ];
  const consumerFixture = buildFixtureDocuments(consumerRequirements, consumerDenials, [correctDesktopMachineDocument()]);
  assertSelfTest(
    consumerAuthorityFindings(consumerFixture).every((finding) => !finding.includes('-INV')),
    'valid consumer unbounded/raw/assemble denials must produce zero inverse findings',
  );
}

function runSnapshotHashSpecificityFixture() {
  const requirementEntry = runtimeRequirements.find((entry) => entry.id === 'LAHC-R013');
  const owner = requirementEntry.owners[0];
  const snapshotInstanceSpecific = {
    subject: 'localagent-source-snapshot-hash',
    action: 'set-specificity',
    object: 'identical-normalized-materialization',
    value: 'instance-specific',
    polarity: 'require',
  };
  assertSelfTest(
    relationEquals(inverseActive(requirementEntry.relation), snapshotInstanceSpecific),
    'LAHC-R013 inverse must be snapshot_hash instance specificity',
  );
  const fixture = buildFixtureDocuments(runtimeRequirements, [{
    owner,
    relation: snapshotInstanceSpecific,
  }]);
  const findings = runtimeAuthorityFindings(fixture);
  assertSelfTest(
    hasExactInverseFinding(findings, requirementEntry, owner, snapshotInstanceSpecific),
    'LAHC-R013 must reject snapshot_hash=instance-specific with an exact inverse finding',
  );
}

function runCensusFixtures() {
  const correctMachine = correctDesktopMachineDocument();
  const oldPersona = selfTestDocument(
    ownerPaths.retiredDesktopPersonaActions,
    'machine_id: desktop_realm_persona_local_materialization_action_model\n',
    'yaml',
  );
  const oldFindings = consumerAuthorityFindings(buildFixtureDocuments(consumerRequirements, [], [correctMachine, oldPersona]));
  assertSelfTest(findingHasId(oldFindings, 'LAHC-C101'), 'old Persona materialization owner must remain RED');

  const shortened = selfTestDocument(
    ownerPaths.incorrectDesktopSourceActions,
    'machine_id: desktop_source_local_materialization_action_model\n',
    'yaml',
  );
  const shortenedFindings = consumerAuthorityFindings(buildFixtureDocuments(consumerRequirements, [], [correctMachine, shortened]));
  assertSelfTest(findingHasId(shortenedFindings, 'LAHC-C102'), 'shortened materialization path must remain RED');
  assertSelfTest(findingHasId(shortenedFindings, 'LAHC-C103'), 'shortened materialization machine id must remain RED');
}

function runTraceabilityParserSelfTests() {
  assertSelfTest(
    extractCompactRuleIds('K-AGCORE-159/160, P-TEST-009/012/013/014').join(',')
      === 'K-AGCORE-159,K-AGCORE-160,P-TEST-009,P-TEST-012,P-TEST-013,P-TEST-014',
    'compact slash-separated rule IDs must expand to complete canonical IDs',
  );
  const rows = [...expectedTraceabilityMappings]
    .map(([requirementId, ruleIds]) => `| ${requirementId} | ${ruleIds.join(', ')} | fixture |`)
    .join('\n');
  const fixture = `## 4. Requirement → authority → scenario coverage\n\n${rows}\n\n## 5. Fixture end\n`;
  const parsed = parseTraceabilityRows(fixture);
  assertSelfTest(parsed.size === expectedTraceabilityMappings.size, 'traceability parser must find all eleven required rows');
  for (const [requirementId, expectedRuleIds] of expectedTraceabilityMappings) {
    const cells = parsed.get(requirementId) || [];
    assertSelfTest(cells.length === 1, `${requirementId} traceability fixture row must be unique`);
    assertSelfTest(
      sameOrderedValues(extractCompactRuleIds(cells[0]), expectedRuleIds),
      `${requirementId} traceability fixture mapping must remain exact`,
    );
  }
  assertSelfTest(
    !sameOrderedValues(extractCompactRuleIds('K-AGCORE-159/158, P-TEST-009/012/013/014'), expectedTraceabilityMappings.get('R-BEH-03')),
    'traceability mapping mutation must remain RED',
  );
}

function runAdversarialSelfTests() {
  const expectedRuntimeIds = Array.from({ length: 39 }, (_, index) => `LAHC-R${String(index + 1).padStart(3, '0')}`);
  const expectedConsumerIds = Array.from({ length: 17 }, (_, index) => `LAHC-C${String(index + 1).padStart(3, '0')}`);
  const expectedBehaviorIds = Array.from({ length: 17 }, (_, index) => `LAHC-B${String(index + 1).padStart(3, '0')}`);
  assertSelfTest(
    runtimeRequirements.map((entry) => entry.id).join(',') === expectedRuntimeIds.join(','),
    'Runtime relation census must exactly cover R001..R039',
  );
  assertSelfTest(
    consumerRequirements.map((entry) => entry.id).join(',') === expectedConsumerIds.join(','),
    'consumer relation census must exactly cover C001..C017',
  );
  assertSelfTest(
    conversationReportRequirements.map((entry) => entry.id).join(',') === expectedBehaviorIds.join(','),
    'conversation report relation census must exactly cover B001..B017',
  );
  for (const requirementEntry of [...runtimeRequirements, ...consumerRequirements, ...conversationReportRequirements]) {
    const relation = requirementEntry.relation;
    assertSelfTest(
      [relation.subject, relation.action, relation.object, relation.value, relation.polarity, relation.passiveAction,
        relation.inverseSubject, relation.inverseObject, relation.inverseValue, relation.inversePolarity].every(Boolean),
      `${requirementEntry.id} governing relation and inverse fields must be complete`,
    );
  }
  runRelationFixtureSuite(runtimeRequirements, runtimeAuthorityFindings);
  runRelationFixtureSuite(
    [...consumerRequirements, ...conversationReportRequirements],
    consumerAuthorityFindings,
    [correctDesktopMachineDocument()],
  );
  runSnapshotHashSpecificityFixture();
  runValidDenialFixtures();
  runCensusFixtures();
  runTraceabilityParserSelfTests();

  const siblingIsolation = selfTestDocument('<siblings.yaml>', `records:
  - id: first
    authority_relations:
      - subject: sdk
        action: consume-status
        object: localagent-source
        value: bounded-only
        polarity: require
  - id: second
    authority_relations:
      - subject: sdk
        action: consume-status
        object: localagent-context
        value: unbounded
        polarity: require
`, 'yaml');
  const first = findYamlRecord([siblingIsolation], '<siblings.yaml>', 'id', 'first');
  assertSelfTest(first.value.authority_relations.length === 1, 'YAML relation records must remain sibling-isolated');
}

  runAdversarialSelfTests();
}
