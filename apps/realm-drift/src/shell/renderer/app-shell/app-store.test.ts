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
