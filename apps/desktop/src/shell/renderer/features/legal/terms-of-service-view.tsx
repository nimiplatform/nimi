export function TermsOfServiceView() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-gray-50">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Terms of Service</h1>
          <p className="mt-2 text-sm text-gray-500">Last Updated: 2024-12-30</p>
        </div>

        <div className="space-y-8 text-sm leading-relaxed text-gray-700">
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">1. Introduction</h2>
            <p>
              Welcome to Nimi (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;). By accessing or using our website, mobile
              application, and smart contracts (collectively, the &ldquo;Service&rdquo;), you agree to be bound by
              these Terms of Service (&ldquo;Terms&rdquo;).
            </p>
            <p className="mt-2 font-medium text-gray-900">
              If you do not agree to these Terms, you may not access or use the Service.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">2. Eligibility</h2>
            <p>
              You must be at least 13 years old (or the minimum legal age in your jurisdiction) to use
              Nimi. By using Nimi, you represent that:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>You have the full right, power, and authority to enter into this agreement.</li>
              <li>
                You are not located in, or a national or resident of, any country subject to sanctions
                (e.g., sanctioned by the OFAC, UN, or EU).
              </li>
              <li>
                Your access to the Service is not prohibited by applicable laws in your jurisdiction.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">
              3. Web3 &amp; Wallet Interactions
            </h2>
            <div className="space-y-4">
              <div>
                <h3 className="mb-1 font-medium text-gray-900">3.1 Non-Custodial Service</h3>
                <p>
                  Nimi is a non-custodial platform. We do not have custody or control over the
                  contents of your cryptocurrency wallet or your private keys. You are solely
                  responsible for:
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-6">
                  <li>Safeguarding your private keys and seed phrases.</li>
                  <li>Approving transactions and smart contract interactions.</li>
                </ul>
              </div>
              <div>
                <h3 className="mb-1 font-medium text-gray-900">3.2 Blockchain Transactions &amp; Gas Fees</h3>
                <p>
                  You acknowledge that transactions on the blockchain (e.g., Ethereum, Solana,
                  Polygon) are irreversible. Nimi has no control over the blockchain network and
                  cannot reverse executed transactions. You are responsible for all gas fees
                  associated with your interactions on the blockchain.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">4. User Accounts &amp; Identity</h2>
            <p>
              To access certain features, you may be required to connect a compatible third-party
              wallet (e.g., MetaMask, WalletConnect). Your wallet address functions as your identity
              on Nimi.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>You are responsible for all activities that occur under your wallet address.</li>
              <li>
                We reserve the right to terminate or suspend your access if we detect suspicious
                activity or a violation of these Terms.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">5. User Conduct</h2>
            <p>Nimi is a social space. You agree NOT to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>Post illegal, hateful, harassing, or sexually explicit content.</li>
              <li>Engage in &ldquo;Rug Pulls,&rdquo; &ldquo;Pump and Dump&rdquo; schemes, or other financial scams.</li>
              <li>
                Use bots, scrapers, or automated tools to manipulate the Service or token metrics.
              </li>
              <li>Impersonate others or misrepresent your affiliation with any person or entity.</li>
              <li>Upload viruses or malicious code.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">
              6. Intellectual Property &amp; Content
            </h2>
            <div className="space-y-4">
              <div>
                <h3 className="mb-1 font-medium text-gray-900">6.1 Your Content</h3>
                <p>
                  You retain ownership of the content you create and post on Nimi. However, by posting
                  content, you grant Nimi a worldwide, non-exclusive, royalty-free license to use,
                  copy, reproduce, and display that content for the purpose of operating and improving
                  the Service.
                </p>
              </div>
              <div>
                <h3 className="mb-1 font-medium text-gray-900">6.2 Platform IP</h3>
                <p>
                  All rights, title, and interest in the Service (including the Nimi logo, UI design,
                  and code) are and will remain the exclusive property of Nimi and its licensors.
                </p>
              </div>
              <div>
                <h3 className="mb-1 font-medium text-gray-900">
                  6.3 NFT &amp; Token Ownership (If applicable)
                </h3>
                <p>If the Service involves NFTs or Tokens:</p>
                <ul className="mt-2 list-disc space-y-1 pl-6">
                  <li>Ownership is defined by the smart contract state on the blockchain.</li>
                  <li>
                    Nimi does not guarantee the value, stability, or liquidity of any digital asset
                    associated with the Service.
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">
              7. Disclaimers &amp; Risk Assumptions
            </h2>
            <p className="mb-2 font-medium uppercase text-red-600">
              THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT WARRANTIES OF ANY KIND.
            </p>
            <p>By using Nimi, you explicitly acknowledge and accept the following risks:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>
                <strong>Volatility:</strong> The prices of crypto assets are extremely volatile.
              </li>
              <li>
                <strong>Smart Contract Risks:</strong> While we strive for security, smart contracts
                may contain bugs or vulnerabilities. We are not liable for funds lost due to protocol
                exploits.
              </li>
              <li>
                <strong>Regulatory Uncertainty:</strong> Changes in laws and regulations regarding
                blockchain technology may affect the viability of the Service.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">8. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, Nimi shall not be liable for any indirect,
              incidental, special, consequential, or punitive damages, or any loss of profits or
              revenues, whether incurred directly or indirectly, or any loss of data, use, goodwill,
              or other intangible losses, resulting from:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>Your access to or use of or inability to access or use the Service;</li>
              <li>
                Any unauthorized access to or use of our servers and/or any personal information
                stored therein.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">9. Indemnification</h2>
            <p>
              You agree to indemnify and hold harmless Nimi and its officers, directors, employees,
              and agents from any claims, disputes, demands, liabilities, damages, losses, and costs
              and expenses, including, without limitation, reasonable legal and accounting fees
              arising out of your violation of these Terms.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">10. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with the laws of Singapore,
              without regard to its conflict of law principles.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">11. Changes to Terms</h2>
            <p>
              We may modify these Terms at any time. We will provide notice of such changes by
              updating the &ldquo;Last Updated&rdquo; date. Your continued use of the Service confirms your
              acceptance of the updated Terms.
            </p>
          </section>
        </div>

        <div className="mt-12 border-t border-gray-200 pt-8 text-center text-xs text-gray-400">
          <p>&copy; 2024 Nimi. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
