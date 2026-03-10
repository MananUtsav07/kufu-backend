import type { WebsiteType } from './detectWebsiteType.js';

export type InstallGuidePayload = {
  title: string;
  steps: string[];
  scriptExample: string;
};

export function buildInstallGuide(args: {
  websiteType: WebsiteType;
  scriptExample: string;
}): InstallGuidePayload {
  const sharedFinalStep =
    'Publish your site and open it in a new tab to confirm the Kufu widget appears.';

  const guideByType: Record<WebsiteType, Omit<InstallGuidePayload, 'scriptExample'>> = {
    wordpress: {
      title: 'Install on WordPress',
      steps: [
        'Open your WordPress admin dashboard.',
        'Go to Appearance > Theme File Editor, or use a header/footer code plugin.',
        'Paste the Kufu embed snippet before the closing </body> tag.',
        sharedFinalStep,
      ],
    },
    shopify: {
      title: 'Install on Shopify',
      steps: [
        'Open Shopify Admin > Online Store > Themes.',
        'Choose your live theme and click Edit code.',
        'Open theme.liquid and paste the Kufu embed snippet before </body>.',
        sharedFinalStep,
      ],
    },
    react: {
      title: 'Install on React',
      steps: [
        'Open your React project source code.',
        'Paste the Kufu embed snippet in public/index.html before </body>.',
        'Rebuild and deploy your frontend.',
        sharedFinalStep,
      ],
    },
    nextjs: {
      title: 'Install on Next.js',
      steps: [
        'Open your Next.js project.',
        'Add the Kufu embed snippet in root layout (app/layout.tsx) or custom document.',
        'Deploy the updated build to production.',
        sharedFinalStep,
      ],
    },
    webflow: {
      title: 'Install on Webflow',
      steps: [
        'Open Webflow Project Settings.',
        'Go to Custom Code > Footer Code.',
        'Paste the Kufu embed snippet and save.',
        sharedFinalStep,
      ],
    },
    wix: {
      title: 'Install on Wix',
      steps: [
        'Open your Wix site dashboard.',
        'Go to Settings > Custom Code.',
        'Add custom code to body end and paste the Kufu embed snippet.',
        sharedFinalStep,
      ],
    },
    squarespace: {
      title: 'Install on Squarespace',
      steps: [
        'Open Squarespace Settings > Advanced > Code Injection.',
        'Paste the Kufu embed snippet in Footer.',
        'Save and refresh the live site.',
        sharedFinalStep,
      ],
    },
    custom: {
      title: 'Install on Custom Website',
      steps: [
        'Open your website source code.',
        'Paste the Kufu embed snippet before the closing </body> tag.',
        'Deploy your updated site.',
        sharedFinalStep,
      ],
    },
    unknown: {
      title: 'Universal Installation Guide',
      steps: [
        'Open your website builder or source code editor.',
        'Paste the Kufu embed snippet before the closing </body> tag.',
        'Publish your changes.',
        sharedFinalStep,
      ],
    },
  };

  const selectedGuide = guideByType[args.websiteType] ?? guideByType.unknown;

  return {
    title: selectedGuide.title,
    steps: selectedGuide.steps,
    scriptExample: args.scriptExample,
  };
}
