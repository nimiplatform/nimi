import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ContactRecord, ContactRequestRecord, TabFilter } from './contacts-model';
import { formatContactRelativeTime, getContactInitial } from './contacts-model';

type ContactsViewProps = {
  searchText: string;
  activeFilter: TabFilter;
  humansCount: number;
  agentsCount: number;
  myAgentsCount: number;
  requestsCount: number;
  blocksCount: number;
  agentLimit: {
    used: number;
    limit: number;
    canAdd: boolean;
    reason: string | null;
  } | null;
  filteredContacts: ContactRecord[];
  filteredRequests: ContactRequestRecord[];
  loading: boolean;
  error: boolean;
  onSearchTextChange: (value: string) => void;
  onFilterChange: (filter: TabFilter) => void;
  onMessage: (contact: ContactRecord) => void;
  onViewProfile: (contact: ContactRecord) => void;
  onViewRequestProfile: (request: ContactRequestRecord) => void;
  onAcceptRequest: (request: ContactRequestRecord) => void;
  onRejectRequest: (request: ContactRequestRecord) => void;
  onCancelRequest: (request: ContactRequestRecord) => void;
  onRemoveFriend: (contact: ContactRecord) => void;
  onBlockFriend?: (contact: ContactRecord) => void;
  onUnblockUser?: (contact: ContactRecord) => void;
  onOpenAddContact: () => void;
};

// User levels type
 type UserLevel = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
 
 interface UserStats {
   asset: UserLevel;
   influence: UserLevel;
   interaction: UserLevel;
   activity: UserLevel;
 }
 
 // Level color mapping
 const levelColors: Record<UserLevel, string> = {
  L1: '#64748b', // Slate 500 (darker gray for visibility)
   L2: '#22c55e', // Green
   L3: '#3b82f6', // Blue
   L4: '#f97316', // Orange
   L5: '#a855f7', // Purple
 };
 
 // Get highest level color for glow ring
 function getHighestLevelColor(stats: UserStats): string {
   const levels: UserLevel[] = [stats.asset, stats.influence, stats.interaction, stats.activity];
   const levelValues: Record<UserLevel, number> = { L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 };
   const highest = levels.reduce((max, level) => 
     levelValues[level] > levelValues[max] ? level : max
   , 'L1' as UserLevel);
   return levelColors[highest];
 }
 
 // Generate mock stats for demo (in production, these would come from API)
 function getMockStats(contactId: string): UserStats {
   // Generate deterministic mock data based on contactId
   const hash = contactId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
   const levels: UserLevel[] = ['L1', 'L2', 'L3', 'L4', 'L5'];
   return {
     asset: levels[hash % 5] ?? 'L1',
     influence: levels[(hash + 1) % 5] ?? 'L1',
     interaction: levels[(hash + 2) % 5] ?? 'L1',
     activity: levels[(hash + 3) % 5] ?? 'L1',
   };
 }
 
 // Level Tier Card Component - Layout: 3 top cards (no bars) + 1 bottom bar
 function LevelTierCard({ 
   stats, 
   visible 
 }: { 
   stats: UserStats; 
   visible: boolean;
 }) {
   if (!visible) return null;
   
   const levelValues: Record<UserLevel, number> = { L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 };
   
   // Level colors - mint theme
   const levelColorClasses: Record<UserLevel, string> = {
     L1: 'bg-slate-400',
     L2: 'bg-emerald-400',
     L3: 'bg-mint-400',
     L4: 'bg-orange-400',
     L5: 'bg-purple-400',
   };
   
   const levelBorderClasses: Record<UserLevel, string> = {
     L1: 'border-slate-300',
     L2: 'border-emerald-300',
     L3: 'border-mint-300',
     L4: 'border-orange-300',
     L5: 'border-purple-300',
   };
   
   // Top row: 3 tier cards
   const topTiers = [
     { key: 'asset', label: 'Asset Tier', icon: '💎', level: stats.asset },
     { key: 'influence', label: 'Influence Tier', icon: '📢', level: stats.influence },
     { key: 'interaction', label: 'Interaction Tier', icon: '🤝', level: stats.interaction },
   ] as const;
   
   // Bottom row: Activity bar
   const activityTier = { key: 'activity', label: 'Activity Level', icon: '⚡', level: stats.activity };
   
   return (
     <div 
       className="absolute left-full ml-2 pointer-events-none z-50"
       style={{
         top: '28px', // Half of avatar height (56px)
         transform: `translateY(-50%) translateX(${visible ? 0 : -8}px)`,
         opacity: visible ? 1 : 0,
         transition: 'all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
       }}
     >
       {/* White card container - larger size */}
       <div className="bg-white rounded-xl shadow-2xl border border-gray-100 p-4 w-72">
         {/* Header */}
         <div className="text-xs font-bold text-mint-500 uppercase tracking-wider mb-3 text-center">
           Nimi Tiers
         </div>
         
         {/* Top row: 3 tier cards - no progress bars */}
         <div className="flex gap-2 mb-3">
           {topTiers.map((tier, index) => {
             const borderColor = levelBorderClasses[tier.level];
             
             return (
               <div
                 key={tier.key}
                 className={`flex-1 bg-gray-50 ${borderColor} border rounded-lg py-3 px-2 flex flex-col items-center justify-center text-center`}
                 style={{
                   opacity: visible ? 1 : 0,
                   transform: visible ? 'translateY(0)' : 'translateY(-4px)',
                   transition: `all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) ${index * 50}ms`,
                 }}
               >
                 {/* Label - centered */}
                 <span className="text-[10px] font-medium text-gray-600 leading-tight mb-2 w-full text-center">
                   {tier.label}
                 </span>
                 
                 {/* Icon - centered */}
                 <span className="text-lg leading-none mb-2">{tier.icon}</span>
                 
                 {/* Level - centered */}
                 <span className="text-xs font-semibold text-gray-500 leading-none w-full text-center">
                   {tier.level}
                 </span>
               </div>
             );
           })}
         </div>
         
         {/* Bottom row: Activity bar with progress */}
         <div
           className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center gap-3"
           style={{
             opacity: visible ? 1 : 0,
             transform: visible ? 'translateY(0)' : 'translateY(4px)',
             transition: `all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) 150ms`,
           }}
         >
           <span className="text-base">{activityTier.icon}</span>
           <span className="text-xs font-medium text-gray-600 whitespace-nowrap">{activityTier.label}</span>
           <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
             <div 
               className={`h-full ${levelColorClasses[activityTier.level]} rounded-full`}
               style={{ width: `${(levelValues[activityTier.level] / 5) * 100}%` }}
             />
           </div>
           <span className="text-xs font-bold text-gray-500">{activityTier.level}</span>
         </div>
       </div>
       
       {/* Arrow pointing to avatar */}
       <div 
         className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full"
         style={{
           width: 0,
           height: 0,
           borderTop: '5px solid transparent',
           borderBottom: '5px solid transparent',
           borderRight: '6px solid white',
         }}
       />
     </div>
   );
 }

export function ContactsView(props: ContactsViewProps) {
  const { t } = useTranslation();
  const [removingContact, setRemovingContact] = useState<ContactRecord | null>(null);
  const [blockingContact, setBlockingContact] = useState<ContactRecord | null>(null);
  const [unblockingContact, setUnblockingContact] = useState<ContactRecord | null>(null);
  const [hoveredContact, setHoveredContact] = useState<ContactRecord | null>(null);
  const [moreMenuContactId, setMoreMenuContactId] = useState<string | null>(null);

  if (props.loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        {t('Contacts.loading')}
      </div>
    );
  }

  if (props.error) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-red-600">
        {t('Contacts.loadError')}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6">
        <h1 className="text-lg font-semibold tracking-tight text-gray-900">{t('Contacts.title')}</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={props.onOpenAddContact}
            className="flex h-8 items-center gap-1.5 rounded-[10px] bg-mint-500 px-3 text-sm font-medium text-white hover:bg-mint-600 transition-colors shadow-sm"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <line x1="20" y1="8" x2="20" y2="14" />
              <line x1="23" y1="11" x2="17" y2="11" />
            </svg>
            {t('Contacts.addContact')}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex h-[38px] max-w-md items-center rounded-[10px] border border-gray-200 bg-gray-50 px-3">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#99a1af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="ml-2 flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
            placeholder={t('Contacts.searchPlaceholder')}
            value={props.searchText}
            onChange={(event) => props.onSearchTextChange(event.target.value)}
          />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-4 border-b border-gray-200 bg-white px-6 py-3">
        <button
          type="button"
          onClick={() => props.onFilterChange('humans')}
          className={`rounded-[10px] px-4 py-2 text-sm font-medium transition-colors ${
            props.activeFilter === 'humans' ? 'bg-mint-50 text-mint-700' : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          {t('Contacts.tabHumans')} ({props.humansCount})
        </button>
        <button
          type="button"
          onClick={() => props.onFilterChange('agents')}
          className={`rounded-[10px] px-4 py-2 text-sm font-medium transition-colors ${
            props.activeFilter === 'agents' ? 'bg-mint-50 text-mint-700' : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          {t('Contacts.tabAgents')} ({props.agentsCount})
        </button>
        <button
          type="button"
          onClick={() => props.onFilterChange('myAgents')}
          className={`rounded-[10px] px-4 py-2 text-sm font-medium transition-colors ${
            props.activeFilter === 'myAgents' ? 'bg-mint-50 text-mint-700' : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          {t('Contacts.tabMyAgents')} ({props.myAgentsCount})
        </button>
        <button
          type="button"
          onClick={() => props.onFilterChange('requests')}
          className={`rounded-[10px] px-4 py-2 text-sm font-medium transition-colors ${
            props.activeFilter === 'requests' ? 'bg-mint-50 text-mint-700' : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          {t('Contacts.tabRequests')} ({props.requestsCount})
        </button>
        <button
          type="button"
          onClick={() => props.onFilterChange('blocks')}
          className={`rounded-[10px] px-4 py-2 text-sm font-medium transition-colors ${
            props.activeFilter === 'blocks' ? 'bg-mint-50 text-mint-700' : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          {t('Contacts.tabBlocks')} ({props.blocksCount})
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-[#F5F7FA] px-6 pt-6">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-gray-700">
            {props.activeFilter === 'humans'
              ? t('Contacts.yourHumanContacts')
              : props.activeFilter === 'agents'
                ? t('Contacts.yourAgentFriends')
                : props.activeFilter === 'myAgents'
                  ? t('Contacts.yourMyAgents')
                : props.activeFilter === 'requests'
                  ? t('Contacts.pendingRequests')
                  : t('Contacts.blockedContacts')}
          </h2>
          <p className="mt-3 text-xs text-gray-500">
            {props.activeFilter === 'humans'
              ? t('Contacts.humansDescription')
              : props.activeFilter === 'agents'
                ? t('Contacts.agentFriendsDescription')
                : props.activeFilter === 'myAgents'
                  ? t('Contacts.myAgentsDescription')
                : props.activeFilter === 'requests'
                  ? t('Contacts.requestsDescription')
                  : t('Contacts.blocksDescription')}
          </p>
          {props.activeFilter === 'agents' && props.agentLimit ? (
            <p className="mt-1 text-xs text-gray-500">
              {t('Contacts.agentFriendLimit')}: {props.agentLimit.used}/{props.agentLimit.limit}
              {props.agentLimit.reason ? ` · ${props.agentLimit.reason}` : ''}
            </p>
          ) : null}
        </div>

        {/* Contacts Grid */}
        {props.activeFilter !== 'requests' && props.filteredContacts.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">
            {props.searchText ? t('Contacts.noMatchingContacts') : t('Contacts.noContacts')}
          </p>
        ) : null}

        {props.activeFilter !== 'requests' && props.filteredContacts.length > 0 ? (
          <div className="grid gap-4 pb-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {props.filteredContacts.map((contact) => (
              <div 
                key={contact.id} 
                className={`flex flex-col rounded-xl border p-4 shadow-sm relative ${
                  contact.isAgent 
                    ? 'bg-slate-50 border-slate-200' 
                    : 'border-white/60 bg-white/40 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl'
                }`}
              >
                {/* Header: Avatar + Name + Badge */}
                <div className="flex items-start justify-between gap-3">
                  <div
                    className="flex min-w-0 flex-1 cursor-pointer gap-3"
                    onClick={() => props.onViewProfile(contact)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') props.onViewProfile(contact); }}
                  >
                    <div 
                      className="relative shrink-0"
                      onMouseEnter={() => !contact.isAgent && setHoveredContact(contact)}
                      onMouseLeave={() => setHoveredContact(null)}
                    >
                      {(() => {
                        // Pre-calculate stats and ring color for humans
                        const stats = !contact.isAgent ? getMockStats(contact.id) : null;
                        const humanRingColor = stats ? getHighestLevelColor(stats) : null;
                        
                        return (
                          <>
                            {contact.avatarUrl ? (
                              <img 
                                src={contact.avatarUrl} 
                                alt={contact.displayName} 
                                className={`h-14 w-14 object-cover ${
                                  contact.isAgent 
                                    ? 'rounded-lg' 
                                    : 'rounded-full'
                                }`} 
                                style={contact.isAgent ? {
                                  boxShadow: '0 0 0 2px #a855f7, 0 0 8px 3px rgba(168, 85, 247, 0.5), 0 0 16px 6px rgba(124, 58, 237, 0.3)'
                                } : humanRingColor ? {
                                  boxShadow: `0 0 0 2px ${humanRingColor}` 
                                } : undefined}
                              />
                            ) : (
                              <div 
                                className={`flex h-14 w-14 items-center justify-center text-sm font-semibold ${
                                  contact.isAgent 
                                    ? 'rounded-lg bg-slate-100 text-slate-700' 
                                    : 'rounded-full bg-mint-100 text-mint-700'
                                }`}
                                style={contact.isAgent ? {
                                  boxShadow: '0 0 0 2px #a855f7, 0 0 8px 3px rgba(168, 85, 247, 0.5), 0 0 16px 6px rgba(124, 58, 237, 0.3)'
                                } : humanRingColor ? {
                                  boxShadow: `0 0 0 2px ${humanRingColor}` 
                                } : undefined}
                              >
                                {getContactInitial(contact.displayName)}
                              </div>
                            )}
                            {/* Level Tier Card - only for humans on hover */}
                            {!contact.isAgent && hoveredContact?.id === contact.id && stats && (
                              <LevelTierCard 
                                stats={stats}
                                visible={true}
                              />
                            )}
                          </>
                        );
                      })()}
                    </div>

                    <div className="min-w-0 flex-1">
                      {/* Name row with gender icons */}
                      <div className="flex items-center gap-2">
                        <span className="truncate text-base font-bold text-gray-800">{contact.displayName}</span>
                        {/* Gender icons - pink for female, blue for male */}
                        {contact.gender ? (
                          <span className="flex items-center gap-0.5">
                            {contact.gender === 'female' || contact.gender === 'other' ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EC4899" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="9" r="5" />
                                <path d="M12 14v7" />
                                <path d="M9 18h6" />
                              </svg>
                            ) : null}
                            {contact.gender === 'male' || contact.gender === 'other' ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="10" cy="10" r="5" />
                                <path d="m14 14 6 6" />
                                <path d="M20 14v6" />
                                <path d="M14 20h6" />
                              </svg>
                            ) : null}
                          </span>
                        ) : null}
                      </div>
                      
                      {/* Handle */}
                      <div className="text-xs text-gray-400 mt-0.5">@{contact.handle.replace(/^@/, '')}</div>
                      
                      {/* Age and Location row */}
                      <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-500">
                        {contact.age ? (
                          <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full ${
                            contact.isAgent ? 'bg-slate-100' : 'bg-white/60'
                          }`}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 6a2 2 0 0 0-2 2v2H6v2h12v-2h-4V8a2 2 0 0 0-2-2z" />
                              <path d="M6 12v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8" />
                              <path d="M6 12h12" />
                              <path d="M8 6V4a2 2 0 0 1 4 0v2" />
                            </svg>
                            <span className="font-medium">{contact.age}</span>
                          </span>
                        ) : null}
                        {contact.location ? (
                          <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full truncate max-w-[120px] ${
                            contact.isAgent ? 'bg-slate-100' : 'bg-white/60'
                          }`}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                              <circle cx="12" cy="10" r="3" />
                            </svg>
                            <span className="truncate">{contact.location}</span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bio */}
                {contact.bio ? (
                  <p className="mt-3 text-sm text-gray-600 line-clamp-2">{contact.bio}</p>
                ) : null}

                {/* Tags */}
                {contact.tags && contact.tags.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {contact.tags.slice(0, 4).map((tag, idx) => (
                      <span key={idx} className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium ${
                        contact.isAgent ? 'bg-slate-100 text-slate-600' : 'bg-[#4ECCA3]/15 text-[#2A9D8F]'
                      }`}>
                        #{tag}
                      </span>
                    ))}
                    {contact.tags.length > 4 ? (
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium ${
                        contact.isAgent ? 'bg-slate-100 text-slate-500' : 'bg-[#4ECCA3]/10 text-[#2A9D8F]'
                      }`}>
                        +{contact.tags.length - 4}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {/* Action Buttons */}
                <div className="mt-auto pt-4 flex gap-2 items-center">
                  {props.activeFilter === 'blocks' ? (
                    // Blocked contact - show Unblock button
                    <button
                      type="button"
                      onClick={() => setUnblockingContact(contact)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-mint-500 py-2 text-sm font-medium text-white hover:bg-mint-600 transition-colors shadow-sm"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <path d="m8 12 2.5 2.5L16 9" />
                      </svg>
                      Unblock
                    </button>
                  ) : (
                    // Normal contact - show Message (except Agents/My Agents tabs) and More menu
                    <>
                      {props.activeFilter !== 'agents' && props.activeFilter !== 'myAgents' ? (
                        <button
                          type="button"
                          onClick={() => props.onMessage(contact)}
                          className={`flex items-center justify-center gap-1.5 rounded-lg bg-mint-500 py-2 text-sm font-medium text-white hover:bg-mint-600 transition-colors shadow-sm ${
                            moreMenuContactId === contact.id && !contact.isAgent && props.activeFilter === 'humans'
                              ? 'flex-[0.6]' 
                              : 'flex-1'
                          }`}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                          </svg>
                          {!(moreMenuContactId === contact.id && !contact.isAgent && props.activeFilter === 'humans') && t('Contacts.message')}
                        </button>
                      ) : null}

                      {/* More menu button - only for humans */}
                      {!contact.isAgent && props.activeFilter === 'humans' && (
                        <div className="relative flex items-center">
                          {/* More button - fixed position on the right */}
                          <button
                            type="button"
                            onClick={() => setMoreMenuContactId(moreMenuContactId === contact.id ? null : contact.id)}
                            className="relative z-10 flex h-[38px] w-[38px] items-center justify-center rounded-full bg-gray-200 text-gray-500 hover:bg-gray-300 hover:text-gray-700 transition-colors shrink-0"
                            aria-label="More options"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="5" r="1.5" />
                              <circle cx="12" cy="12" r="1.5" />
                              <circle cx="12" cy="19" r="1.5" />
                            </svg>
                          </button>

                          {/* Expanded action buttons - slide out from behind the more button to the left */}
                          <div 
                            className={`flex items-center gap-2 overflow-hidden transition-all duration-300 ease-out absolute right-[42px] ${
                              moreMenuContactId === contact.id ? 'w-auto opacity-100' : 'w-0 opacity-0'
                            }`}
                          >
                            {/* Block button */}
                            <button
                              type="button"
                              onClick={() => {
                                setMoreMenuContactId(null);
                                setBlockingContact(contact);
                              }}
                              className="flex items-center justify-center gap-1.5 rounded-lg bg-gray-600 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors shadow-sm whitespace-nowrap"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                              </svg>
                              Block
                            </button>
                            {/* Remove friend button */}
                            <button
                              type="button"
                              onClick={() => {
                                setMoreMenuContactId(null);
                                setRemovingContact(contact);
                              }}
                              className="flex items-center justify-center gap-1.5 rounded-lg bg-red-500 px-3 py-2 text-sm font-medium text-white hover:bg-red-600 transition-colors shadow-sm whitespace-nowrap"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                <circle cx="8.5" cy="7" r="4" />
                                <line x1="18" y1="8" x2="23" y2="13" />
                                <line x1="23" y1="8" x2="18" y2="13" />
                              </svg>
                              Remove
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Requests List */}
        {props.activeFilter === 'requests' && props.filteredRequests.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">
            {props.searchText ? t('Contacts.noMatchingRequests') : t('Contacts.noPendingRequests')}
          </p>
        ) : null}

        {props.activeFilter === 'requests' && props.filteredRequests.length > 0 ? (
          <div className="flex flex-col gap-3 pb-6" style={{ maxWidth: '900px' }}>
            {props.filteredRequests.map((request) => (
              <div 
                key={`${request.direction}:${request.userId}`} 
                className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm"
              >
                {/* Left: Avatar + Info */}
                <div className="flex items-center gap-3 shrink-0" style={{ width: '200px' }}>
                  {request.avatarUrl ? (
                    <img 
                      src={request.avatarUrl} 
                      alt={request.displayName} 
                      className="h-11 w-11 rounded-full object-cover ring-2 ring-gray-100 shrink-0" 
                    />
                  ) : (
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-mint-100 text-sm font-semibold text-mint-700 ring-2 ring-gray-100 shrink-0">
                      {getContactInitial(request.displayName)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-gray-900 truncate">{request.displayName}</span>
                    </div>
                    {request.handle ? (
                      <p className="text-xs text-gray-400 truncate">{request.handle}</p>
                    ) : null}
                    {request.requestedAt ? (
                      <p className="text-[10px] text-gray-400">
                        {formatContactRelativeTime(request.requestedAt)}
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* Middle: Message Bubble */}
                <div className="flex-1 min-w-0">
                  <div className="inline-block max-w-full rounded-2xl rounded-tl-sm bg-gray-100 px-4 py-2.5">
                    <p className="text-sm text-gray-600">
                      {request.bio || 'Hi! I\'d like to add you as a friend.'}
                    </p>
                  </div>
                </div>

                {/* Right: Action Buttons - Fixed Width */}
                <div className="flex items-center gap-2 shrink-0" style={{ width: '160px' }}>
                  {request.direction === 'received' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => props.onAcceptRequest(request)}
                        className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-mint-500 py-2 text-xs font-medium text-white hover:bg-mint-600 transition-colors shadow-sm"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => props.onRejectRequest(request)}
                        className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-gray-100 py-2 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                        Reject
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => props.onCancelRequest(request)}
                      className="flex w-full items-center justify-center gap-1 rounded-lg bg-gray-100 py-2 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Remove Friend Confirmation Modal */}
      {removingContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="8.5" cy="7" r="4" />
                  <line x1="18" y1="8" x2="23" y2="13" />
                  <line x1="23" y1="8" x2="18" y2="13" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Remove Friend</h3>
                <p className="text-sm text-gray-500">
                  Are you sure you want to remove <span className="font-semibold text-gray-700">{removingContact.displayName}</span> from your friends?
                </p>
              </div>
            </div>
            
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setRemovingContact(null)}
                className="rounded-xl px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  props.onRemoveFriend(removingContact);
                  setRemovingContact(null);
                }}
                className="rounded-xl bg-red-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-600 transition-colors shadow-sm"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Block Confirmation Dialog */}
      {blockingContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-800 text-white">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Block User</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Are you sure you want to block <span className="font-semibold text-gray-700">{blockingContact.displayName}</span>?
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  They will be hidden from your contacts and added to your blocked list.
                </p>
              </div>
            </div>
            
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setBlockingContact(null)}
                className="rounded-xl px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  props.onBlockFriend?.(blockingContact);
                  setBlockingContact(null);
                }}
                className="rounded-xl bg-gray-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-900 transition-colors shadow-sm"
              >
                Block
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unblock Confirmation Dialog */}
      {unblockingContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-mint-100 text-mint-600">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="m8 12 2.5 2.5L16 9" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Unblock User</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Are you sure you want to unblock <span className="font-semibold text-gray-700">{unblockingContact.displayName}</span>?
                </p>
              </div>
            </div>
            
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setUnblockingContact(null)}
                className="rounded-xl px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  props.onUnblockUser?.(unblockingContact);
                  setUnblockingContact(null);
                }}
                className="rounded-xl bg-mint-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-mint-600 transition-colors shadow-sm"
              >
                Unblock
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
