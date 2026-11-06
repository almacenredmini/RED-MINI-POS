import { Card, EmptyState } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import type { IconName } from '@/components/ui/Icon';

interface Props {
  title: string;
  icon: IconName;
  stage: number;
  features: string[];
}

export function ComingSoonPage({ title, icon, stage, features }: Props) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <EmptyState icon={icon} title={`Llega en la Etapa ${stage}`}>
          <p>{features.join(' · ')}</p>
        </EmptyState>
      </Card>
    </>
  );
}
