import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AppAgentCenterEntry } from '@nimiplatform/kit/features/agent-center';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogClose } from '@nimiplatform/kit/ui';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';

// Management selects an authorized Agent reference without opening its chat.
// The shared Agent Center owns all settings and mutations.
export function LocalAgentManagementDialog({open,onOpenChange}:{open:boolean;onOpenChange:(open:boolean)=>void}){
 const sdk=useDesktopRendererSdk();const {t,i18n}=useTranslation();
 const client=useMemo(()=>sdk.appProduct(),[sdk]);
 return <Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent className="flex max-h-[90vh] w-[min(1100px,calc(100vw-2rem))] max-w-none flex-col" aria-describedby={undefined}>
   <DialogHeader className="flex flex-row items-center justify-between"><DialogTitle>{t('Chat.managePartners')}</DialogTitle><DialogClose asChild><Button tone="ghost" size="sm">{t('Common.close',{defaultValue:'Close'})}</Button></DialogClose></DialogHeader>
   <DialogBody className="min-h-0 flex-1 overflow-auto">{open?<AppAgentCenterEntry client={client} language={i18n.language}/>:null}</DialogBody>
  </DialogContent>
 </Dialog>;
}
