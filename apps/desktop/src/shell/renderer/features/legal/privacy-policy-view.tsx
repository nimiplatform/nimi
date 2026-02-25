export function PrivacyPolicyView() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-gray-50">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Privacy Policy</h1>
          <p className="mt-2 text-sm text-gray-500">Last Updated: 2025-12-29</p>
        </div>

        <div className="space-y-8 text-sm leading-relaxed text-gray-700">
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">1. Introduction</h2>
            <p>
              Welcome to Nimi (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;). We value your privacy and are committed to
              protecting your personal data. This Privacy Policy explains how we collect, use,
              disclose, and safeguard your information when you access our website, mobile
              application, and decentralized application (dApp) (collectively, the &ldquo;Service&rdquo;).
            </p>
            <p className="mt-2 font-medium text-gray-900">
              Please read this privacy policy carefully. If you do not agree with the terms of this
              privacy policy, please do not access the Service.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">2. Information We Collect</h2>
            <p>We collect information in the following ways:</p>

            <div className="mt-4 space-y-4">
              <div>
                <h3 className="mb-1 font-medium text-gray-900">2.1 Information You Provide Directly</h3>
                <ul className="list-disc space-y-1 pl-6">
                  <li>
                    <strong>Wallet Address:</strong> When you connect your cryptocurrency wallet
                    (e.g., MetaMask, Phantom) to Nimi, we collect your public wallet address. This
                    acts as your primary identifier.
                  </li>
                  <li>
                    <strong>Profile Information:</strong> If you choose to create a social profile, we
                    may collect information such as a username, bio, profile picture (NFT or image),
                    and social media links (e.g., Twitter/X, Discord handle).
                  </li>
                  <li>
                    <strong>Communication Data:</strong> If you contact us for support or feedback, we
                    collect your email address and the content of your message.
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="mb-1 font-medium text-gray-900">2.2 Automatically Collected Information</h3>
                <ul className="list-disc space-y-1 pl-6">
                  <li>
                    <strong>Device &amp; Usage Data:</strong> We may collect information about your
                    device, browser type, IP address, operating system, and how you interact with our
                    Service (e.g., session duration, pages visited).
                  </li>
                  <li>
                    <strong>Cookies:</strong> We use cookies and similar tracking technologies to
                    enhance user experience and analyze traffic.
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="mb-1 font-medium text-gray-900">2.3 Information from the Blockchain</h3>
                <p className="mb-2 font-medium text-red-600">
                  Important: Nimi is a Web3 application. Your public wallet address and your
                  interactions with our smart contracts are recorded on a public blockchain.
                </p>
                <ul className="list-disc space-y-1 pl-6">
                  <li>
                    <strong>On-Chain Data:</strong> We may index and display data that is publicly
                    available on the blockchain, such as your token holdings (NFTs, Coins) and
                    transaction history related to Nimi. We do not control this data, and it cannot be
                    deleted or hidden by us.
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">
              3. How We Use Your Information
            </h2>
            <p>We use the collected information to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>Provide, operate, and maintain the Service.</li>
              <li>Verify your identity using your wallet address.</li>
              <li>
                Display your public profile and on-chain assets to other users within the Nimi
                ecosystem.
              </li>
              <li>Detect and prevent fraudulent activities, bots, or security breaches.</li>
              <li>Analyze usage patterns to improve the Service (analytics).</li>
              <li>Comply with legal obligations (if applicable).</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">
              4. Disclosure of Your Information
            </h2>
            <p>
              We do not sell your personal information. We may share information in the following
              situations:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>
                <strong>Public Visibility:</strong> Any information you post on the blockchain or your
                public Nimi profile is viewable by anyone.
              </li>
              <li>
                <strong>Service Providers:</strong> We may share data with third-party vendors who
                perform services for us (e.g., cloud hosting, data analytics, customer support tools),
                subject to confidentiality agreements.
              </li>
              <li>
                <strong>Legal Requirements:</strong> We may disclose your information if required to
                do so by law or in response to valid requests by public authorities (e.g., a court or
                a government agency).
              </li>
              <li>
                <strong>Business Transfers:</strong> If Nimi is involved in a merger, acquisition, or
                sale of assets, your information may be transferred as part of that transaction.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">
              5. The Nature of Blockchain &amp; Privacy
            </h2>
            <p>You acknowledge that:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>
                <strong>Transparency:</strong> Transactions on the blockchain are public and
                permanent. Anyone can view the transactions associated with your wallet address.
              </li>
              <li>
                <strong>Immutability:</strong> Once data is written to the blockchain, Nimi cannot
                delete, modify, or conceal it. This includes any content or metadata you choose to
                mint or interact with on-chain.
              </li>
              <li>
                <strong>No Anonymity:</strong> While your wallet address is pseudonymous, it can
                potentially be linked to your real-world identity through external data sources (e.g.,
                if you publicly link your wallet to your Twitter account).
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">
              6. Third-Party Wallets and Links
            </h2>
            <p>
              Our Service allows you to connect third-party wallets. We do not control these wallet
              providers (e.g., MetaMask, Ledger). Your use of those wallets is governed by their own
              terms and privacy policies. We are not responsible for the security of your private
              keys.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">7. Data Security</h2>
            <p>
              We use administrative, technical, and physical security measures to help protect your
              personal information. However, please remember that no method of transmission over the
              Internet or method of electronic storage is 100% secure. We cannot guarantee absolute
              security.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">8. Your Data Rights</h2>
            <p>
              Depending on your jurisdiction (e.g., GDPR for EU users, CCPA for California users), you
              may have the right to:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>Access the personal data we hold about you (off-chain data).</li>
              <li>Request correction of inaccurate data.</li>
              <li>
                Request deletion of your data (Note: We can delete off-chain data held on our servers,
                but we cannot delete data recorded on the blockchain).
              </li>
            </ul>
            <p className="mt-2">To exercise these rights, please contact us at support@nimi.xyz.</p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">9. Children&apos;s Privacy</h2>
            <p>
              Nimi is not intended for individuals under the age of 13. We do not knowingly collect
              personal information from children under 13.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">10. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of any changes
              by updating the &ldquo;Last Updated&rdquo; date at the top of this policy. You are advised to review
              this Privacy Policy periodically for any changes.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">11. Contact Us</h2>
            <p>If you have any questions about this Privacy Policy, please contact us at:</p>
            <p className="mt-2 font-medium text-gray-900">Email: support@nimi.xyz</p>
          </section>
        </div>

        <div className="mt-12 border-t border-gray-200 pt-8 text-center text-xs text-gray-400">
          <p>&copy; 2025 Nimi. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
