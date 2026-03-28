import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

const PrivacyPolicy = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors active:scale-95"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold tracking-tight">Privacy Policy</h1>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-8 space-y-8 text-sm leading-relaxed text-muted-foreground">
        <p className="text-xs">Effective Date: March 22, 2026</p>

        <p>
          This Privacy Policy explains how JC Digital Solutions, a trade name of 1001241196 Ontario
          Inc. ("we", "us", or "our"), collects, uses, and protects your information when you use
          our receipt scanning and storage application (the "App").
        </p>
        <p>By using the App, you agree to this Privacy Policy.</p>

        <Section title="1. Information We Collect">
          <h3 className="text-sm font-medium text-foreground">a. Information from Google Sign-In</h3>
          <p>When you sign in using Google, we collect:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Name</li>
            <li>Email address</li>
            <li>Google account unique identifier</li>
          </ul>
          <p>We do not access your Google Drive, Gmail, or other Google services.</p>

          <h3 className="text-sm font-medium text-foreground mt-4">b. User-Provided Content</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>Receipt images and files you upload</li>
            <li>Extracted data (e.g., totals, dates, merchant names) generated through processing</li>
          </ul>

          <h3 className="text-sm font-medium text-foreground mt-4">c. Technical & Usage Data</h3>
          <p>We may collect limited technical information such as:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Device type and browser</li>
            <li>IP address (for security and logging purposes)</li>
            <li>Timestamps and usage activity</li>
          </ul>
        </Section>

        <Section title="2. How We Use Your Information">
          <p>We use your information to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Authenticate users via Google Sign-In</li>
            <li>Store, display, and manage your receipts</li>
            <li>Process receipts (e.g., OCR and data extraction)</li>
            <li>Maintain and improve the App</li>
            <li>Detect and prevent abuse, fraud, or misuse</li>
          </ul>
        </Section>

        <Section title="3. Data Storage & Location">
          <p>Your data is stored on servers located in Toronto, Ontario, Canada using Google Cloud infrastructure.</p>
          <p>Your information is subject to Canadian data protection laws.</p>
        </Section>

        <Section title="4. Data Sharing">
          <p>We do not sell your personal data.</p>
          <p>We may share your data only in the following cases:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>With service providers (e.g., Google Cloud) strictly to operate the App</li>
            <li>To comply with legal obligations (e.g., court orders, law enforcement requests)</li>
            <li>To protect our rights, users, or the integrity of the service</li>
          </ul>
        </Section>

        <Section title="5. Google User Data Compliance">
          <p>We comply with Google API Services User Data Policy:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>We only access basic profile information (name, email) for authentication</li>
            <li>We do not use Google data for advertising</li>
            <li>We do not sell or transfer Google user data to third parties</li>
          </ul>
        </Section>

        <Section title="6. Data Retention">
          <ul className="list-disc pl-5 space-y-1">
            <li>Your data is retained while your account is active</li>
            <li>You may request deletion at any time</li>
            <li>Deleted data may persist temporarily in backups or logs for a limited period</li>
          </ul>
        </Section>

        <Section title="7. Your Rights">
          <p>Depending on your jurisdiction, you may have the right to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Access your personal data</li>
            <li>Request correction of inaccurate data</li>
            <li>Request deletion of your data</li>
            <li>Withdraw consent and stop using the App</li>
          </ul>
          <p>
            To exercise these rights, contact:{" "}
            <a href="mailto:info@jcdigitalsolutions.ca" className="text-primary underline hover:text-primary/80 transition-colors">
              info@jcdigitalsolutions.ca
            </a>
          </p>
        </Section>

        <Section title="8. Data Deletion">
          <p>
            You may request deletion of your account and associated data by contacting us at:{" "}
            <a href="mailto:info@jcdigitalsolutions.ca" className="text-primary underline hover:text-primary/80 transition-colors">
              info@jcdigitalsolutions.ca
            </a>
          </p>
          <p>We will process deletion requests within a reasonable timeframe, subject to technical and legal limitations.</p>
        </Section>

        <Section title="9. Security">
          <p>We implement reasonable administrative, technical, and organizational safeguards to protect your data.</p>
          <p>However, no system is completely secure, and we cannot guarantee absolute security.</p>
        </Section>

        <Section title="10. Children's Privacy">
          <p>The App is not intended for children under the age of 13.</p>
          <p>We do not knowingly collect personal data from children.</p>
        </Section>

        <Section title="11. International Users">
          <p>If you access the App from outside Canada, your data will be transferred to and processed in Canada.</p>
        </Section>

        <Section title="12. Changes to this Privacy Policy">
          <p>We may update this Privacy Policy from time to time.</p>
          <p>Continued use of the App constitutes acceptance of the updated policy.</p>
        </Section>

        <Section title="13. Contact">
          <p>For privacy-related questions or requests, contact:</p>
          <p className="text-foreground">
            JC Digital Solutions<br />
            (a trade name of 1001241196 Ontario Inc.)<br />
            <a href="mailto:info@jcdigitalsolutions.ca" className="text-primary underline hover:text-primary/80 transition-colors">
              info@jcdigitalsolutions.ca
            </a>
          </p>
        </Section>
      </main>
    </div>
  );
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default PrivacyPolicy;
