import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocation } from "wouter";
import { useConnectBingX } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, KeyRound, Lock, Terminal } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const formSchema = z.object({
  apiKey: z.string().min(1, "API Key is required"),
  secretKey: z.string().min(1, "Secret Key is required"),
});

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const connectMutation = useConnectBingX();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      apiKey: "",
      secretKey: "",
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    connectMutation.mutate(
      { data: values },
      {
        onSuccess: (data) => {
          if (data.connected) {
            toast({
              title: "Connected successfully",
              description: "Redirecting to dashboard...",
            });
            setLocation("/dashboard");
          } else {
            toast({
              title: "Connection failed",
              description: "Invalid API keys",
              variant: "destructive",
            });
          }
        },
        onError: (error) => {
          toast({
            title: "Connection Error",
            description: error.data?.error || "Failed to connect to BingX",
            variant: "destructive",
          });
        },
      }
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="p-3 bg-primary/10 rounded-full mb-4">
            <Terminal className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">BingX Terminal</h1>
          <p className="text-muted-foreground">Professional futures trading dashboard</p>
        </div>

        <Card className="border-muted bg-card shadow-xl">
          <CardHeader>
            <CardTitle>Connect Account</CardTitle>
            <CardDescription>
              Enter your BingX API credentials to access the terminal.
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="apiKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>API Key</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <KeyRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                          <Input className="pl-9 font-mono" placeholder="Enter API Key" {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="secretKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Secret Key</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                          <Input className="pl-9 font-mono" type="password" placeholder="Enter Secret Key" {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button 
                  type="submit" 
                  className="w-full" 
                  disabled={connectMutation.isPending}
                >
                  {connectMutation.isPending ? "Connecting..." : "Connect"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Alert className="bg-primary/5 border-primary/20 text-primary-foreground/80">
          <AlertCircle className="h-4 w-4 text-primary" />
          <AlertTitle className="text-primary font-medium">Security Notice</AlertTitle>
          <AlertDescription className="text-sm mt-2 opacity-90 leading-relaxed">
            Your API Key and Secret are sent to our server and stored only in your browser session. They are never saved to a database. For optimal security, we recommend creating a read-only API key with no withdrawal permissions.
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}
