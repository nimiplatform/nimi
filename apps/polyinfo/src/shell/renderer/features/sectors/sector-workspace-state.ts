export function buildCurrentReadMessage(input: {
  sectorLabel: string;
  latestAnalystText: string;
  marketDataRequested: boolean;
  analysisReady: boolean;
  loadingMarketData: boolean;
}): string {
  const { sectorLabel, latestAnalystText, marketDataRequested, analysisReady, loadingMarketData } = input;
  if (latestAnalystText.trim()) {
    return latestAnalystText;
  }
  if (loadingMarketData) {
    return `${sectorLabel} 的价格和历史窗口正在准备中。`;
  }
  if (!marketDataRequested) {
    return `${sectorLabel} 的 event 已就绪。可以先讨论结构；需要可靠盘口判断时再点击 Load Prices。`;
  }
  if (analysisReady) {
    return `${sectorLabel} 的价格已就绪。现在可以发起聊天，或者直接点上方快捷问题开始分析。`;
  }
  return `${sectorLabel} 的价格窗口还没准备完成。请稍等，或稍后重新点击 Load Prices。`;
}

export function buildEmptyConversationMessage(input: {
  sectorLabel: string;
  marketDataRequested: boolean;
  analysisReady: boolean;
  loadingMarketData: boolean;
}): string {
  const { sectorLabel, marketDataRequested, analysisReady, loadingMarketData } = input;
  if (loadingMarketData) {
    return `${sectorLabel} 正在加载价格窗口…`;
  }
  if (!marketDataRequested) {
    return `还没有聊天记录。可以先讨论 ${sectorLabel} 的 narrative 和 core issue；未加载价格前，盘口判断只能作为粗略讨论。`;
  }
  if (analysisReady) {
    return `还没有聊天记录。${sectorLabel} 的价格已准备好，等你主动发起分析。`;
  }
  return `还没有聊天记录。${sectorLabel} 的价格窗口还在准备中。`;
}

export function buildManualAnalysisGuardMessage(input: {
  sectorLabel: string;
  windowLabel: string;
}): string {
  const { sectorLabel, windowLabel } = input;
  return `请先点击 Load Prices，加载 ${sectorLabel} 在 ${windowLabel} 窗口下的价格和历史数据，再发起盘口分析。`;
}
