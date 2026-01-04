import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="relative min-h-screen flex flex-col">
      <Header user={user} />
      <main className="flex-1">
        {/* Hero Section */}
        <section className="container flex flex-col items-center justify-center gap-4 py-24 md:py-32">
          <h1 className="text-center text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl">
            Design Your Perfect
            <br />
            <span className="text-primary">Pedalboard</span>
          </h1>
          <p className="max-w-[600px] text-center text-lg text-muted-foreground md:text-xl">
            Plan, arrange, and optimize your guitar effects setup.
            Get signal chain recommendations, physical fit checking,
            and complete wiring diagrams.
          </p>
          <div className="flex flex-col gap-4 sm:flex-row">
            <Link href={user ? '/dashboard' : '/signup'}>
              <Button size="lg" className="min-w-[200px]">
                {user ? 'Go to Dashboard' : 'Get Started Free'}
              </Button>
            </Link>
            <Link href="#features">
              <Button size="lg" variant="outline" className="min-w-[200px]">
                Learn More
              </Button>
            </Link>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="container py-16 md:py-24">
          <h2 className="text-center text-3xl font-bold tracking-tight mb-12">
            Everything You Need
          </h2>
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              title="Signal Chain Optimization"
              description="Automatically arrange your pedals in the optimal signal order. Understand why each pedal goes where."
            />
            <FeatureCard
              title="Physical Fit Checking"
              description="Know exactly what fits on your board before you build. Accurate dimensions with collision detection."
            />
            <FeatureCard
              title="Effects Loop Routing"
              description="Support for effects loops, 4-cable method, and complex routing. Visualize your complete signal path."
            />
            <FeatureCard
              title="Wiring Diagrams"
              description="Generate clear wiring diagrams showing every connection. Never miss a cable again."
            />
            <FeatureCard
              title="Cable Lists"
              description="Get exact cable requirements with lengths and types. Know what to buy before you build."
            />
            <FeatureCard
              title="Pedal Database"
              description="Hundreds of pedals with accurate dimensions and specs. Add your own custom pedals too."
            />
          </div>
        </section>

        {/* CTA Section */}
        <section className="container py-16 md:py-24">
          <div className="flex flex-col items-center gap-4 rounded-lg border bg-card p-8 md:p-12">
            <h2 className="text-center text-2xl font-bold tracking-tight md:text-3xl">
              Ready to design your pedalboard?
            </h2>
            <p className="text-center text-muted-foreground max-w-[500px]">
              Stop guessing and start planning. Create your free account and design your first board today.
            </p>
            <Link href={user ? '/dashboard' : '/signup'}>
              <Button size="lg">
                {user ? 'Open Dashboard' : 'Create Free Account'}
              </Button>
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-6 md:py-8">
        <div className="container flex flex-col items-center justify-between gap-4 md:flex-row">
          <p className="text-sm text-muted-foreground">
            PedalSchema - Design your perfect pedalboard
          </p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-6">
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
