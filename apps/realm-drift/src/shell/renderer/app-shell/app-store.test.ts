import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './app-store.js';

describe('DriftAppStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useAppStore.setState({
      auth: { status: 'bootstrapping', user: null, token: '', refreshToken: '' },
      bootstrapReady: false,
      bootstrapError: null,
      runtimeDefaults: null,
      marbleJobs: {},
      activeChat: null,
      activeRightPanelTab: 'agents',
      humanChats: {},
      activeHumanChat: null,
      friendList: [],
      onlineUsers: new Set(),
    });
  });

  describe('auth', () => {
    it('sets auth session', () => {
      const user = { id: 'u1', displayName: 'Test User' };
      useAppStore.getState().setAuthSession(user, 'token123', 'refresh456');

      const state = useAppStore.getState();
      expect(state.auth.status).toBe('authenticated');
      expect(state.auth.user).toEqual(user);
      expect(state.auth.token).toBe('token123');
      expect(state.auth.refreshToken).toBe('refresh456');
    });

    it('clears auth session', () => {
      const user = { id: 'u1', displayName: 'Test' };
      useAppStore.getState().setAuthSession(user, 'tok', 'ref');
      useAppStore.getState().clearAuthSession();

      const state = useAppStore.getState();
      expect(state.auth.status).toBe('unauthenticated');
      expect(state.auth.user).toBeNull();
      expect(state.auth.token).toBe('');
    });
  });

  describe('bootstrap', () => {
    it('sets bootstrap ready', () => {
      useAppStore.getState().setBootstrapReady(true);
      expect(useAppStore.getState().bootstrapReady).toBe(true);
    });

    it('sets bootstrap error', () => {
      useAppStore.getState().setBootstrapError('Something failed');
      expect(useAppStore.getState().bootstrapError).toBe('Something failed');
    });
  });

  describe('marbleJobs', () => {
    it('sets and clears marble jobs', () => {
      const job = {
        operationId: 'op1',
        status: 'generating' as const,
        startedAt: Date.now(),
      };
      useAppStore.getState().setMarbleJob('world1', job);
      expect(useAppStore.getState().marbleJobs['world1']).toEqual(job);

      useAppStore.getState().clearMarbleJob('world1');
      expect(useAppStore.getState().marbleJobs['world1']).toBeUndefined();
    });

    it('supports idle status', () => {
      const job = {
        operationId: null,
        status: 'idle' as const,
        startedAt: null,
      };
      useAppStore.getState().setMarbleJob('world2', job);
      expect(useAppStore.getState().marbleJobs['world2']?.status).toBe('idle');
    });

    it('stores viewerUrl and error fields', () => {
      const job = {
        operationId: 'op2',
        status: 'completed' as const,
        viewerUrl: 'https://marble.worldlabs.ai/world/w1',
        startedAt: 1000,
      };
      useAppStore.getState().setMarbleJob('world3', job);
      expect(useAppStore.getState().marbleJobs['world3']?.viewerUrl).toBe('https://marble.worldlabs.ai/world/w1');

      const failedJob = {
        operationId: 'op3',
        status: 'failed' as const,
        error: 'Generation timed out',
        startedAt: 2000,
      };
      useAppStore.getState().setMarbleJob('world4', failedJob);
      expect(useAppStore.getState().marbleJobs['world4']?.error).toBe('Generation timed out');
    });
  });

  describe('activeChat', () => {
    it('sets and clears active chat', () => {
      const chat = {
        worldId: 'w1',
        agentId: 'a1',
        agentName: 'Agent One',
        messages: [],
        streaming: false,
        partialText: '',
      };
      useAppStore.getState().setActiveChat(chat);
      expect(useAppStore.getState().activeChat?.agentId).toBe('a1');

      useAppStore.getState().setActiveChat(null);
      expect(useAppStore.getState().activeChat).toBeNull();
    });

    it('appends chat message', () => {
      useAppStore.getState().setActiveChat({
        worldId: 'w1',
        agentId: 'a1',
        agentName: 'Agent One',
        messages: [],
        streaming: false,
        partialText: '',
      });

      useAppStore.getState().appendChatMessage({
        id: 'm1',
        role: 'user',
        content: 'hello',
        timestamp: 1000,
      });

      expect(useAppStore.getState().activeChat?.messages.length).toBe(1);
      expect(useAppStore.getState().activeChat?.messages[0]?.content).toBe('hello');
    });

    it('sets streaming state', () => {
      useAppStore.getState().setActiveChat({
        worldId: 'w1',
        agentId: 'a1',
        agentName: 'Agent One',
        messages: [],
        streaming: false,
        partialText: '',
      });

      useAppStore.getState().setStreamingState(true, 'partial...');
      expect(useAppStore.getState().activeChat?.streaming).toBe(true);
      expect(useAppStore.getState().activeChat?.partialText).toBe('partial...');
    });
  });

  describe('panel tab', () => {
    it('switches active right panel tab', () => {
      expect(useAppStore.getState().activeRightPanelTab).toBe('agents');
      useAppStore.getState().setActiveRightPanelTab('people');
      expect(useAppStore.getState().activeRightPanelTab).toBe('people');
    });
  });

  describe('humanChats', () => {
    it('sets human chat and appends message', () => {
      useAppStore.getState().setHumanChat('chat1', {
        chatId: 'chat1',
        friendUserId: 'f1',
        messages: [],
      });
      expect(useAppStore.getState().humanChats['chat1']?.chatId).toBe('chat1');

      useAppStore.getState().appendHumanChatMessage('chat1', {
        id: 'hm1',
        role: 'user',
        content: 'hi friend',
        timestamp: 2000,
      });
      expect(useAppStore.getState().humanChats['chat1']?.messages.length).toBe(1);
    });

    it('keeps active human chat in sync when realtime message arrives', () => {
      useAppStore.getState().setHumanChat('chat-sync', {
        chatId: 'chat-sync',
        friendUserId: 'f1',
        messages: [],
      });
      useAppStore.getState().setActiveHumanChat({
        chatId: 'chat-sync',
        friendName: 'Alice',
        messages: [],
        loading: false,
      });

      useAppStore.getState().appendHumanChatMessage('chat-sync', {
        id: 'hm-sync',
        role: 'assistant',
        content: 'realtime hello',
        timestamp: 4000,
      });

      expect(useAppStore.getState().activeHumanChat?.messages).toHaveLength(1);
      expect(useAppStore.getState().activeHumanChat?.messages[0]?.content).toBe('realtime hello');
    });
  });

  describe('activeHumanChat', () => {
    it('sets and clears active human chat', () => {
      useAppStore.getState().setActiveHumanChat({
        chatId: 'chat1',
        friendName: 'Alice',
        messages: [],
        loading: false,
      });
      expect(useAppStore.getState().activeHumanChat?.chatId).toBe('chat1');
      expect(useAppStore.getState().activeHumanChat?.friendName).toBe('Alice');

      useAppStore.getState().setActiveHumanChat(null);
      expect(useAppStore.getState().activeHumanChat).toBeNull();
    });

    it('appends message to active human chat', () => {
      useAppStore.getState().setActiveHumanChat({
        chatId: 'chat2',
        friendName: 'Bob',
        messages: [],
        loading: false,
      });

      useAppStore.getState().appendActiveHumanMessage({
        id: 'hm2',
        role: 'user',
        content: 'hey Bob',
        timestamp: 3000,
      });

      expect(useAppStore.getState().activeHumanChat?.messages.length).toBe(1);
      expect(useAppStore.getState().activeHumanChat?.messages[0]?.content).toBe('hey Bob');
    });

    it('has loading state', () => {
      useAppStore.getState().setActiveHumanChat({
        chatId: 'chat3',
        friendName: 'Carol',
        messages: [],
        loading: true,
      });
      expect(useAppStore.getState().activeHumanChat?.loading).toBe(true);
    });

    it('updates and removes active human chat messages through shared chat actions', () => {
      useAppStore.getState().setHumanChat('chat4', {
        chatId: 'chat4',
        friendUserId: 'f4',
        messages: [{ id: 'm1', role: 'assistant', content: 'old', timestamp: 1 }],
      });
      useAppStore.getState().setActiveHumanChat({
        chatId: 'chat4',
        friendName: 'Dana',
        messages: [{ id: 'm1', role: 'assistant', content: 'old', timestamp: 1 }],
        loading: false,
      });

      useAppStore.getState().updateHumanMessage('chat4', 'm1', 'new');
      expect(useAppStore.getState().activeHumanChat?.messages[0]?.content).toBe('new');

      useAppStore.getState().removeHumanMessage('chat4', 'm1');
      expect(useAppStore.getState().activeHumanChat?.messages).toHaveLength(0);
    });
  });

  describe('social', () => {
    it('manages friend list', () => {
      useAppStore.getState().setFriendList([
        { userId: 'f1', displayName: 'Friend 1' },
        { userId: 'f2', displayName: 'Friend 2' },
      ]);
      expect(useAppStore.getState().friendList.length).toBe(2);
    });

    it('manages online users', () => {
      useAppStore.getState().addOnlineUser('u1');
      useAppStore.getState().addOnlineUser('u2');
      expect(useAppStore.getState().onlineUsers.size).toBe(2);

      useAppStore.getState().removeOnlineUser('u1');
      expect(useAppStore.getState().onlineUsers.size).toBe(1);
      expect(useAppStore.getState().onlineUsers.has('u2')).toBe(true);
    });

    it('sets online users as set', () => {
      useAppStore.getState().setOnlineUsers(new Set(['a', 'b', 'c']));
      expect(useAppStore.getState().onlineUsers.size).toBe(3);
    });
  });
});
