import assert from 'node:assert/strict';

export function runAccountSessionHardcutSelfTest({
  AVATAR_LAUNCH_FORBIDDEN_QUERY_PARAMETERS,
  NON_ADMITTED_LOCAL_APP_SLICE_FENCE_MARKER,
  NON_ADMITTED_LOCAL_APP_SLICE_FENCE_SPECS,
  NON_ADMITTED_LOCAL_APP_SLICE_ROOTS,
  scanAccountSessionHardcut,
}) {
  const files = [
    {
      relPath: 'apps/desktop/test/local-negative.test.ts',
      source: "createPlatformClient({ realmBaseUrl: 'https://realm', accessTokenProvider: () => token });",
    },
    {
      relPath: 'apps/desktop/test/external-positive.test.ts',
      source: "createPlatformClient({ authMode: 'external-principal', realmBaseUrl: 'https://realm', subjectUserIdProvider: () => subject });",
    },
    {
      relPath: 'sdk/test/local-negative.test.ts',
      source: "createPlatformClient({ authMode: 'local-first-party-runtime', realmBaseUrl: 'https://realm', refreshTokenProvider: () => refresh });",
    },
    {
      relPath: 'sdk/test/web-positive.test.ts',
      source: "createPlatformClient({ authMode: 'web-cloud', realmBaseUrl: 'https://realm', refreshTokenProvider: () => refresh });",
    },
    {
      relPath: 'apps/avatar/src/shell/renderer/bad.ts',
      source: "runtime.account.getAccessToken({}); RuntimeAuthService.RegisterApp({}); runtime.agent.anchors.open({});",
    },
    {
      relPath: 'apps/avatar/src/shell/renderer/good.ts',
      source: "runtime.agent.turns.request({ scopedBinding });",
    },
    {
      relPath: 'apps/avatar/src-tauri/capabilities/default.json',
      source: JSON.stringify({ permissions: ['core:default'] }),
    },
    {
      relPath: 'apps/avatar/src-tauri/capabilities/bad.json',
      source: JSON.stringify({ permissions: ['runtime.account.GetAccessToken'] }),
    },
    {
      relPath: 'apps/avatar/src-tauri/tauri.conf.json',
      source: JSON.stringify({
        app: {
          security: {
            assetProtocol: {
              scope: [
                '$HOME/.nimi/data/accounts/*/agents/*/agent-center/modules/avatar_asset/packages/*/*/files/**',
                '$HOME/ai/**',
              ],
            },
          },
        },
      }),
    },
    // For each currently NON-admitted local app slice, supply a spec fixture
    // that carries the fence marker. If NON_ADMITTED_LOCAL_APP_SLICE_ROOTS is
    // empty (i.e. all in-tree slices are admitted), this expansion is a no-op.
    ...NON_ADMITTED_LOCAL_APP_SLICE_ROOTS.map((root) => ({
      relPath: NON_ADMITTED_LOCAL_APP_SLICE_FENCE_SPECS.get(root),
      source: `${NON_ADMITTED_LOCAL_APP_SLICE_FENCE_MARKER}: non-admitted local app slice; legacy auth seams are fenced until Runtime admission migration.`,
    })),
    {
      relPath: 'runtime/internal/services/account/bad.go',
      source: 'func read() { _ = "auth_session_load"; _ = "subject_user_id" }',
    },
    {
      relPath: 'runtime/internal/services/account/service.go',
      source: `
func (s *Service) GetAccountSessionStatus(ctx context.Context, req *Request) {
  s.validateRuntimeAdmittedCaller(ctx, req.GetCaller(), false)
  s.mu.RLock()
}
func (s *Service) GetAccessToken(ctx context.Context, req *Request) { s.validateRuntimeAdmittedCaller(ctx, req.GetCaller(), true) }
func (s *Service) SubscribeAccountSessionEvents(ctx context.Context, req *Request) {
  s.validateRuntimeAdmittedCaller(ctx, req.GetCaller(), false)
  s.subscribe(req)
}
func (s *Service) RefreshAccountSession(ctx context.Context, req *Request) {
  return &Response{AccountReasonCode: ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED}
}
func (s *Service) Logout(ctx context.Context, req *Request) {
  s.validateRuntimeAccountControlCaller(ctx, req.GetCaller())
  s.logout(ctx, reason)
}
func (s *Service) SwitchAccount(ctx context.Context, req *Request) {
  s.validateRuntimeAccountControlCaller(ctx, req.GetCaller())
  s.mu.Lock()
}
func (s *Service) InvokeRealmUnary(ctx context.Context, req *Request) {
  s.validateRuntimeAdmittedCaller(ctx, req.GetCaller(), false)
  parseRealmUnaryRequest(req)
}
func (s *Service) IssueScopedAppBinding(ctx context.Context, req *Request) {
  s.validateScopedBindingCaller(ctx, req.GetCaller())
  validateBindingCallerRelation(req.GetCaller(), relation)
}
func (s *Service) RevokeScopedAppBinding(ctx context.Context, req *Request) {
  s.validateScopedBindingCaller(ctx, req.GetCaller())
  validateBindingCallerRelation(req.GetCaller(), record.relation)
  s.mu.Lock()
}
func (s *Service) validateRuntimeAdmittedCaller() { s.registry.AdmitLocalFirstPartyInstance("", "") }
func (s *Service) ValidateScopedBinding() {
  if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {}
}
func (s *Service) markCustodyUnavailable() { s.revokeBindingsLocked(reason) }
func (s *Service) transitionToReauthRequired() { s.revokeBindingsLocked(reason) }
func (s *Service) ObserveRefreshToken() { s.revokeBindingsLocked(reason) }
`,
    },
    {
      relPath: 'apps/desktop/src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-launcher.ts',
      source: 'export const payload = { agentId, avatarAssetId, avatarPackageId };',
    },
    {
      relPath: 'apps/desktop/src-tauri/src/main_parts/defaults_and_commands/window_and_logs.rs',
      source: 'serializer.append_pair("agent_id", agent_id.as_str());',
    },
    {
      relPath: 'apps/desktop/src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-store.ts',
      source: 'const DESKTOP_AVATAR_STORE_DECOMMISSIONED_MESSAGE = "closed"; export async function listDesktopAgentAvatarResources() { throw new Error(DESKTOP_AVATAR_STORE_DECOMMISSIONED_MESSAGE); }',
    },
    {
      relPath: 'apps/avatar/src/shell/renderer/bridge/launch-context.ts',
      source: AVATAR_LAUNCH_FORBIDDEN_QUERY_PARAMETERS.join('\n'),
    },
    {
      relPath: 'apps/avatar/src-tauri/src/avatar_launch_context.rs',
      source: AVATAR_LAUNCH_FORBIDDEN_QUERY_PARAMETERS.join('\n'),
    },
    {
      relPath: 'apps/avatar/src-tauri/src/agent_center_avatar_asset.rs',
      source: 'struct Payload { agent_id: String, avatar_asset_id: String }',
    },
    {
      relPath: 'apps/web/src/desktop-adapter/runtime-bootstrap.web.ts',
      source: "export const WEB_CLOUD_ADAPTER_AUTH_MODE = 'web-cloud-adapter' as const;",
    },
    {
      relPath: 'apps/web/src/positive.ts',
      source: "createPlatformClient({ authMode: 'web-cloud', accessTokenProvider: () => token });",
    },
    {
      relPath: 'apps/web/src/negative.ts',
      source: "createPlatformClient({ accessTokenProvider: () => token });",
    },
    {
      relPath: 'external-workspaces/example/src/bad.ts',
      source: 'runtime.account.getAccessToken({});',
    },
    {
      relPath: 'external-workspaces/example/src/good.ts',
      source: 'host.capabilities.invoke("runtime.agent.turn.write");',
    },
  ];

  const violations = scanAccountSessionHardcut(files);
  assert.equal(violations.some((item) => item.includes('local-negative.test.ts') && item.includes('accessTokenProvider')), true);
  assert.equal(violations.some((item) => item.includes('external-positive.test.ts')), false);
  assert.equal(violations.some((item) => item.includes('local-negative.test.ts') && item.includes('refreshTokenProvider')), true);
  assert.equal(violations.some((item) => item.includes('web-positive.test.ts')), false);
  assert.equal(violations.some((item) => item.includes('bad.ts') && item.includes('Avatar forbidden')), true);
  assert.equal(violations.some((item) => item.includes('good.ts') && item.includes('Avatar forbidden')), false);
  assert.equal(violations.some((item) => item.includes('bad.json') && item.includes('Avatar forbidden Tauri permission')), true);
  assert.equal(violations.some((item) => item.includes('default.json') && item.includes('Avatar forbidden Tauri permission')), false);
  assert.equal(violations.some((item) => item.includes('tauri.conf.json') && item.includes('Avatar broad .nimi asset scope')), false);
  assert.equal(violations.some((item) => item.includes('bad.go') && item.includes('Runtime account broker')), true);
  assert.equal(violations.some((item) => item.includes('chat-agent-avatar-launcher.ts') && item.includes('Desktop Avatar launch authority field')), true);
  assert.equal(violations.some((item) => item.includes('runtime-bootstrap.web.ts')), false);
  assert.equal(violations.some((item) => item.includes('apps/web/src/negative.ts')), true);
  assert.equal(violations.some((item) => item.includes('apps/web/src/positive.ts')), false);
  assert.equal(violations.some((item) => item.includes('external-workspaces/example/src/bad.ts')), false);
  assert.equal(violations.some((item) => item.includes('external-workspaces/example/src/good.ts')), false);

  // Negative case: an unfenced spec in an entry of NON_ADMITTED_LOCAL_APP_SLICE_ROOTS
  // MUST trigger the Non-admitted local app slice fence violation. We
  // simulate this by injecting a synthetic non-admitted root + spec map for
  // the duration of this assertion.
  if (NON_ADMITTED_LOCAL_APP_SLICE_ROOTS.length > 0) {
    const sliceRoot = NON_ADMITTED_LOCAL_APP_SLICE_ROOTS[0];
    const sliceSpecPath = NON_ADMITTED_LOCAL_APP_SLICE_FENCE_SPECS.get(sliceRoot);
    const filesMissingFence = files
      .filter((file) => file.relPath !== sliceSpecPath)
      .concat({
        relPath: sliceSpecPath,
        source: 'no fence text here',
      });
    const fenceViolations = scanAccountSessionHardcut(filesMissingFence);
    assert.equal(
      fenceViolations.some((item) => item.includes('Non-admitted local app slice fence')),
      true,
      'expected Non-admitted local app slice fence violation when marker is absent',
    );
  }

  const p1NegativeViolations = scanAccountSessionHardcut([
    {
      relPath: 'runtime/internal/services/account/service.go',
      source: `
func (s *Service) GetAccountSessionStatus(req *Request) {
  validateProductionCaller(req.GetCaller(), false)
  s.mu.RLock()
}
func (s *Service) GetAccessToken() { validateProductionCaller(req.GetCaller(), true) }
func (s *Service) SubscribeAccountSessionEvents(req *Request) {
  s.subscribe(req)
}
func (s *Service) RefreshAccountSession(req *Request) {
  s.mu.Lock()
  s.refresher.Refresh(ctx, current)
}
func (s *Service) Logout(req *Request) {
  return s.logout(ctx, reason)
}
func (s *Service) SwitchAccount(req *Request) {
  s.mu.Lock()
}
func (s *Service) InvokeRealmUnary(req *Request) {
  parseRealmUnaryRequest(req)
}
func (s *Service) IssueScopedAppBinding() { validateProductionCaller(req.GetCaller(), false) }
func (s *Service) RevokeScopedAppBinding() {
  s.mu.Lock()
  record.relation.State = runtimev1.ScopedAppBindingState_SCOPED_APP_BINDING_STATE_REVOKED
}
func (s *Service) ValidateScopedBinding() { record := s.bindings[id]; _ = record }
func (s *Service) markCustodyUnavailable() {}
func (s *Service) transitionToReauthRequired() {}
func (s *Service) ObserveRefreshToken() {}
`,
    },
    {
      relPath: 'apps/desktop/src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-launcher.ts',
      source: 'export const payload = { agentCenterAccountId: accountId, agentId };',
    },
    {
      relPath: 'apps/desktop/src-tauri/src/main_parts/defaults_and_commands/window_and_logs.rs',
      source: 'serializer.append_pair("binding_id", binding_id.as_str());',
    },
    {
      relPath: 'apps/desktop/src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-store.ts',
      source: 'export async function listDesktopAgentAvatarResources() { return invokeChecked("desktop_agent_avatar_resource_list", {}, parse); }',
    },
    {
      relPath: 'apps/avatar/src/shell/renderer/bridge/launch-context.ts',
      source: AVATAR_LAUNCH_FORBIDDEN_QUERY_PARAMETERS.join('\n'),
    },
    {
      relPath: 'apps/avatar/src-tauri/src/avatar_launch_context.rs',
      source: AVATAR_LAUNCH_FORBIDDEN_QUERY_PARAMETERS.join('\n'),
    },
    {
      relPath: 'apps/avatar/src-tauri/src/agent_center_avatar_asset.rs',
      source: 'struct Payload { agent_center_account_id: String, subject_user_id: String }',
    },
    {
      relPath: 'apps/avatar/src-tauri/tauri.conf.json',
      source: JSON.stringify({ app: { security: { assetProtocol: { scope: ['$HOME/.nimi/**'] } } } }),
    },
  ]);
  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime status caller admission')), true);
  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime GetAccessToken caller admission')), true);
  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime account event subscription caller admission')), true);
  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime public refresh boundary')), true);
  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime logout caller admission')), true);
  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime switch caller admission')), true);
  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime Realm unary caller admission')), true);
  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime binding caller admission')), true);
  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime binding relation admission')), true);
  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime binding revoke caller admission')), true);
  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime binding revoke relation admission')), true);
  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime binding authenticated-state validation')), true);
  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime binding non-auth revocation')), true);
  assert.equal(p1NegativeViolations.some((item) => item.includes('Desktop Avatar launch authority field')), true);
  assert.equal(p1NegativeViolations.some((item) => item.includes('Desktop Avatar handoff URI authority field')), true);
  assert.equal(p1NegativeViolations.some((item) => item.includes('Avatar broad .nimi asset scope')), true);
  process.stdout.write('account-session hardcut self-test passed\n');
}
