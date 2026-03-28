import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

const TermsOfService = () => {
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
        <h1 className="text-lg font-semibold tracking-tight">Terms of Service</h1>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-8 space-y-8 text-sm leading-relaxed text-muted-foreground">
        <p className="text-xs">Effective Date: March 22, 2026</p>

        <p>
          These Terms of Service ("Terms") govern your use of the receipt scanning and storage
          application (the "App"), operated by JC Digital Solutions, a trade name of 1001241196
          Ontario Inc. ("we", "us", or "our").
        </p>
        <p>By accessing or using the App, you agree to these Terms.</p>

        <Section title="1. Use of the App">
          <p>
            The App allows users to upload, store, and manage receipt images and related data for
            personal or business use.
          </p>
          <p>
            You agree to use the App only for lawful purposes and in compliance with all applicable
            laws.
          </p>
        </Section>

        <Section title="2. Eligibility">
          <p>
            You must be at least 13 years old (or the minimum legal age in your jurisdiction) to use
            this App.
          </p>
        </Section>

        <Section title="3. Account & Authentication">
          <p>The App uses Google Sign-In for authentication.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>We do not store your password</li>
            <li>You are responsible for maintaining access to your Google account</li>
            <li>You are responsible for all activity under your account</li>
          </ul>
        </Section>

        <Section title="4. User Content">
          <p>
            You retain ownership of any receipts, images, or data you upload ("User Content").
          </p>
          <p>By uploading content, you grant us a limited license to store, process, and display it solely for providing the App's functionality.</p>
          <p>You agree not to upload:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Illegal content</li>
            <li>Content you do not have rights to</li>
            <li>Malicious or harmful files</li>
          </ul>
        </Section>

        <Section title="5. Acceptable Use & Abuse Prevention">
          <p>
            You agree not to misuse the App or attempt to disrupt its operation. Prohibited
            activities include, but are not limited to:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Uploading files that are not valid images or receipts</li>
            <li>Uploading excessively large files intended to degrade performance</li>
            <li>Attempting to bypass file size limits, security controls, or validation mechanisms</li>
            <li>Uploading malicious content, including viruses, scripts, or harmful code</li>
            <li>Using automated systems (bots, scripts) to abuse or overload the service</li>
            <li>Using the App as general-purpose file storage unrelated to receipt management</li>
          </ul>
          <p>We reserve the right to remove content, limit uploads, or suspend accounts engaged in abusive behavior without prior notice.</p>
        </Section>

        <Section title="6. File Limits & Technical Restrictions">
          <p>To ensure fair use and system stability:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>We may impose limits on file size, type, and upload frequency</li>
            <li>Files must be valid and supported image formats</li>
            <li>We may reject files that fail validation checks</li>
            <li>Uploads may be rate-limited to prevent abuse</li>
          </ul>
        </Section>

        <Section title="7. Data Storage & Availability">
          <p>
            Your data is stored on cloud infrastructure located in Toronto, Ontario, Canada using
            Google Cloud.
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>The App is not intended as a general backup or archival system</li>
            <li>We do not guarantee permanent storage or availability</li>
            <li>Data loss may occur due to technical issues</li>
            <li>You are responsible for maintaining backups of important records</li>
          </ul>
        </Section>

        <Section title="8. Service Availability">
          <p>We may modify, suspend, or discontinue the App at any time without notice.</p>
        </Section>

        <Section title="9. Termination">
          <p>We may suspend or terminate your access if you violate these Terms or misuse the App.</p>
          <p>You may stop using the App at any time.</p>
        </Section>

        <Section title="10. Disclaimer">
          <ul className="list-disc pl-5 space-y-1">
            <li>The App may use OCR or automated processing, which may produce errors</li>
            <li>The App does not provide financial, accounting, or tax advice</li>
            <li>You are responsible for verifying all receipt data</li>
          </ul>
        </Section>

        <Section title="11. Limitation of Liability">
          <p>To the maximum extent permitted by law, we are not liable for:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Data loss</li>
            <li>Financial losses</li>
            <li>Business decisions made using the App</li>
            <li>Service interruptions</li>
            <li>Unauthorized access resulting from user negligence</li>
          </ul>
        </Section>

        <Section title="12. Governing Law & Dispute Resolution">
          <p>
            These Terms shall be governed by the laws of the Province of Ontario and the federal
            laws of Canada applicable therein. Any disputes shall be subject to the exclusive
            jurisdiction of the courts located in Ontario, Canada.
          </p>
        </Section>

        <Section title="13. Changes to Terms">
          <p>
            We may update these Terms from time to time. Continued use of the App constitutes
            acceptance of the updated Terms.
          </p>
        </Section>

        <Section title="14. Contact">
          <p>
            For questions about these Terms, contact:{" "}
            <a
              href="mailto:info@jcdigitalsolutions.ca"
              className="text-primary underline hover:text-primary/80 transition-colors"
            >
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

export default TermsOfService;
