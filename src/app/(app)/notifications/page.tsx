import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/ui-bits";
import { getAccounts, getCategories } from "@/lib/queries";
import {
  getNotificationChannels,
  getNotificationRules,
  getNotifications,
} from "@/lib/queries/notifications";
import { TRIGGERS, TRIGGER_GROUPS } from "@/lib/notifications/triggers";
import {
  DEMO_ACCOUNTS,
  DEMO_CATEGORIES,
  DEMO_NOTIFICATIONS,
  DEMO_NOTIFICATION_CHANNELS,
  DEMO_NOTIFICATION_RULES,
} from "@/lib/demo-data";
import { NotificationCenter, type TriggerMeta } from "./NotificationCenter";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export const metadata = { title: "Notifications" };

const triggers: TriggerMeta[] = TRIGGERS.map((t) => ({
  id: t.id,
  label: t.label,
  description: t.description,
  group: t.group,
  paramFields: t.paramFields,
  variables: t.variables,
  defaultTemplate: t.defaultTemplate,
}));

export default async function NotificationsPage() {
  if (DEMO_MODE) {
    return (
      <div className="stagger mx-auto max-w-3xl space-y-5">
        <PageHeader title="Notifications" subtitle="Inbox, rules, and Discord delivery." />
        <NotificationCenter
          notifications={DEMO_NOTIFICATIONS}
          rules={DEMO_NOTIFICATION_RULES}
          channels={DEMO_NOTIFICATION_CHANNELS}
          triggers={triggers}
          groups={TRIGGER_GROUPS}
          accounts={DEMO_ACCOUNTS.map((a) => ({ id: a.id, name: a.name }))}
          categories={DEMO_CATEGORIES.map((c) => ({ id: c.id, name: c.name }))}
          readOnly
        />
      </div>
    );
  }

  const { userId } = await requireUser();
  const [notifications, rules, channels, accounts, categories] = await Promise.all([
    getNotifications(userId),
    getNotificationRules(userId),
    getNotificationChannels(userId),
    getAccounts(userId),
    getCategories(userId),
  ]);

  return (
    <div className="stagger mx-auto max-w-3xl space-y-5">
      <PageHeader title="Notifications" subtitle="Inbox, rules, and Discord delivery." />
      <NotificationCenter
        notifications={notifications}
        rules={rules}
        channels={channels}
        triggers={triggers}
        groups={TRIGGER_GROUPS}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
