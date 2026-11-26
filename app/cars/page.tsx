// Car rental landing page. Live car prices arrive as suppliers
// connect — today the page shows the planner's Best value
// estimates, labelled planning estimates.
import type { Metadata } from 'next';
import CategoryLanding from '../../components/CategoryLanding';
import { CATEGORY_LANDING } from '../../lib/categoryLanding';

export const metadata: Metadata = {
  title: CATEGORY_LANDING.cars.metaTitle,
  description: CATEGORY_LANDING.cars.metaDescription,
};

export default function CarsPage() {
  return <CategoryLanding tab="cars" />;
}
