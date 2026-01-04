import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default async function AmpsPage() {
  const supabase = await createClient();

  // Fetch amps (system + user's custom)
  const { data: amps } = await supabase
    .from('amps')
    .select('*')
    .order('manufacturer')
    .order('name');

  return (
    <div className="container py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Amplifier Library</h1>
          <p className="text-muted-foreground">
            Select your amp to configure effects loop routing
          </p>
        </div>
        <Button>Add Custom Amp</Button>
      </div>

      {amps && amps.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {amps.map((amp) => (
            <Card key={amp.id} className="hover:border-primary/50 transition-colors cursor-pointer">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{amp.name}</CardTitle>
                    <CardDescription>{amp.manufacturer}</CardDescription>
                  </div>
                  {amp.has_effects_loop && (
                    <Badge variant="secondary">FX Loop</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground space-y-1">
                  {amp.has_effects_loop ? (
                    <>
                      <p>Loop type: {amp.loop_type}</p>
                      <p>Send: {amp.send_jack_label} / Return: {amp.return_jack_label}</p>
                    </>
                  ) : (
                    <p>No effects loop</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <h3 className="text-lg font-semibold mb-2">No amps found</h3>
            <p className="text-muted-foreground text-center mb-4">
              Run the database seed to populate the amp library
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
