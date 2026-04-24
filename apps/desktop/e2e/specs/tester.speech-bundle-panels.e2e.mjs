import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, clickByTestId, waitForTestId } from '../helpers/app.mjs';

describe('tester.speech-bundle-panels', () => {
  it('opens the desktop tester speech bundle panels', async () => {
    assertScenario('tester.speech-bundle-panels');

    await waitForTestId(E2E_IDS.mainShell);
    await clickByTestId(E2E_IDS.navTab('tester'));
    await waitForTestId(E2E_IDS.panel('tester'));

    await clickByTestId(E2E_IDS.testerCapabilityTab('audio.synthesize'));
    await waitForTestId(E2E_IDS.testerPanel('audio.synthesize'));
    await waitForTestId(E2E_IDS.testerInput('audio-synthesize-text'));

    await clickByTestId(E2E_IDS.testerCapabilityTab('audio.transcribe'));
    await waitForTestId(E2E_IDS.testerPanel('audio.transcribe'));
    await waitForTestId(E2E_IDS.testerInput('audio-transcribe-file'));

    await clickByTestId(E2E_IDS.testerCapabilityTab('voice_workflow.tts_v2v'));
    await waitForTestId(E2E_IDS.testerPanel('voice_workflow.tts_v2v'));
    await waitForTestId(E2E_IDS.testerInput('voice-clone-file'));

    await clickByTestId(E2E_IDS.testerCapabilityTab('voice_workflow.tts_t2v'));
    await waitForTestId(E2E_IDS.testerPanel('voice_workflow.tts_t2v'));
    await waitForTestId(E2E_IDS.testerInput('voice-design-instruction'));
  });
});
