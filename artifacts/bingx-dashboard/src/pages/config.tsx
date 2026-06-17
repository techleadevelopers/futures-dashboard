import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AppShell from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiUrl } from "@/lib/api-url";
import { useToast } from "@/hooks/use-toast";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Database,
  Power,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
} from "lucide-react";

interface RuntimeConfig {
  allowLongEntries: boolean;
  allowShortEntries: boolean;
  allowExecution: boolean;
  hasOverrides: boolean;
}

interface EnvSetting {
  key: string;
  value: string;
  type: "boolean" | "number" | "text";
  group: string;
  requiresRestart: boolean;
  overridden: boolean;
}

const CONFIG_QUERY_KEY = ["runtime-entry-config"] as const;
const ENV_QUERY_KEY = ["runtime-env-settings"] as const;
const PRIMARY_ENV_KEYS = new Set([
  "SCALP_ALLOW_LONG",
  "SCALP_ALLOW_SHORT",
  "SCALP_ALLOW_EXECUTION",
]);

const SETTING_META: Record<string, { title: string; description: string }> = {
  NATIVE_TRIGGER_COOLDOWN_MS: {
    title: "Intervalo entre disparos do Trigger Edge",
    description: "Tempo mínimo antes de o mesmo símbolo e direção poderem disparar novamente. Valor em milissegundos.",
  },
  NATIVE_TRIGGER_INITIAL_EXPIRATION_SECONDS: {
    title: "Validade das ordens iniciais do Trigger",
    description: "Quantos segundos uma ordem LIMIT inicial pode ficar aguardando antes de expirar.",
  },
  NATIVE_TRIGGER_INITIAL_LEVELS_PER_SIDE: {
    title: "Níveis iniciais por direção",
    description: "Quantidade de níveis de entrada criados para LONG e para SHORT em cada símbolo.",
  },
  NATIVE_TRIGGER_BRUTAL_MODE: {
    title: "Modo intensivo do Trigger",
    description: "Ativa a grade ampliada de níveis do Motor Nativo.",
  },
  NATIVE_TRIGGER_LONG_DETECT_PCT: {
    title: "Queda necessária para preparar LONG",
    description: "Queda percentual padrão que faz o Trigger Edge considerar uma entrada LONG.",
  },
  NATIVE_TRIGGER_SHORT_DETECT_PCT: {
    title: "Alta necessária para preparar SHORT",
    description: "Alta percentual padrão que faz o Trigger Edge considerar uma entrada SHORT.",
  },
  EDGE_STRATEGY: {
    title: "Estratégia do Trigger Edge",
    description: "Contrarian entra contra movimentos extremos; continuation acompanha o movimento.",
  },
  EDGE_STRICT_OPPOSITE: {
    title: "Exigir direção oposta ao movimento",
    description: "Quando ativo, uma alta aceita somente SHORT e uma queda aceita somente LONG na estratégia contrária.",
  },
  EDGE_DUMP_LONG_PCT: {
    title: "Queda mínima para sinal LONG",
    description: "Movimento percentual de queda usado pelo Edge para liberar LONG.",
  },
  EDGE_PUMP_SHORT_PCT: {
    title: "Alta mínima para sinal SHORT",
    description: "Movimento percentual de alta usado pelo Edge para liberar SHORT.",
  },
  EDGE_FORCE_SCORE: {
    title: "Pontuação forçada após movimento extremo",
    description: "Score mínimo atribuído quando o movimento alcança o gatilho configurado.",
  },
  EDGE_MIN_SCORE_TO_ENTER: {
    title: "Pontuação mínima para entrar",
    description: "Qualidade mínima exigida pelo Edge antes de permitir uma nova operação.",
  },
  EDGE_LONG_RSI_MAX: {
    title: "RSI máximo para LONG",
    description: "LONG fica mais restrito quando o RSI está acima deste valor.",
  },
  EDGE_SHORT_RSI_MIN: {
    title: "RSI mínimo para SHORT",
    description: "SHORT fica mais restrito quando o RSI está abaixo deste valor.",
  },
  EDGE_VOLUME_MIN_RATIO: {
    title: "Volume mínimo do sinal",
    description: "Relação mínima entre o volume atual e o volume normal para validar o movimento.",
  },
  SCALP_LEVERAGE: {
    title: "Alavancagem das operações",
    description: "Multiplicador de alavancagem aplicado às novas entradas.",
  },
  SCALP_MARGIN_PER_TRADE: {
    title: "Margem por operação",
    description: "Valor de margem em USDT reservado para cada nova entrada.",
  },
  SCALP_TAKE_PROFIT_PCT: {
    title: "Take Profit padrão",
    description: "Percentual de lucro usado como alvo principal das novas operações.",
  },
  SCALP_STOP_LOSS_PCT: {
    title: "Stop Loss padrão",
    description: "Percentual máximo de movimento contrário antes da proteção encerrar a operação.",
  },
  SCALP_MAX_CONCURRENT_POSITIONS: {
    title: "Máximo de posições simultâneas",
    description: "Limite global de posições que podem permanecer abertas ao mesmo tempo.",
  },
  SCALP_MAX_POSITIONS_PER_SYMBOL: {
    title: "Máximo de posições por moeda",
    description: "Limite de entradas acumuladas no mesmo símbolo.",
  },
  SCALP_POSITION_STACKING_ENABLED: {
    title: "Permitir múltiplas entradas",
    description: "Autoriza adicionar novas posições na mesma moeda e direção.",
  },
  SCALP_PREVENT_HEDGED_POSITIONS: {
    title: "Bloquear LONG e SHORT juntos",
    description: "Impede manter posições opostas abertas simultaneamente na mesma moeda.",
  },
  SCALP_ATTACH_PROTECTION_ORDERS: {
    title: "Anexar TP e SL automaticamente",
    description: "Envia as proteções de lucro e perda junto com a ordem de entrada.",
  },
  SCALP_SYMBOLS: {
    title: "Moedas monitoradas",
    description: "Lista de pares que o scanner e o Trigger Edge devem acompanhar.",
  },
  SCALP_HOUR_BLACKLIST: {
    title: "Horários bloqueados",
    description: "Horas UTC, separadas por vírgula, nas quais novas entradas não são permitidas.",
  },
  SCALP_BTC_REGIME_REQUIRED: {
    title: "Exigir confirmação do BTC",
    description: "Usa o movimento do Bitcoin como filtro antes de liberar novas entradas.",
  },
  SCALP_BTC_REGIME_THRESHOLD_PCT: {
    title: "Movimento mínimo do BTC",
    description: "Variação percentual usada para classificar o mercado como alta ou baixa.",
  },
  SCALP_ALLOW_COUNTER_REGIME_SCALP: {
    title: "Permitir operação contra o BTC",
    description: "Autoriza entradas contrárias ao regime atual do Bitcoin.",
  },
  SCALP_AUTOPILOT_INTERVAL_SEC: {
    title: "Intervalo do piloto automático",
    description: "Tempo em segundos entre ciclos de busca por novas entradas.",
  },
  SCALP_AUTOPILOT_MAX_CANDIDATES: {
    title: "Candidatos por ciclo",
    description: "Quantidade máxima de oportunidades avaliadas em cada ciclo automático.",
  },
  SCALP_SNIPER_MIN_COMBINED_SCORE: {
    title: "Score mínimo do Sniper",
    description: "Pontuação combinada mínima para uma oportunidade entrar na fila de execução.",
  },
  MASS_ENTRY_AUTOPILOT_ENABLED: {
    title: "Piloto de entradas em massa",
    description: "Permite armar automaticamente zonas de entrada encontradas pela inteligência.",
  },
  MASS_ENTRY_AUTOPILOT_MAX_ZONES: {
    title: "Máximo de zonas por ciclo",
    description: "Quantidade máxima de zonas que podem ser armadas em um ciclo.",
  },
  MASS_ENTRY_AUTOPILOT_MIN_CONFLUENCE: {
    title: "Confluência mínima das zonas",
    description: "Qualidade mínima exigida para aceitar uma zona de entrada em massa.",
  },
  QUANT_BRAIN_GATE_MODE: {
    title: "Controle do Quant Brain",
    description: "Shadow apenas observa; enforce pode bloquear; off desativa a decisão do Quant Brain.",
  },
  QUANT_BRAIN_ENABLED: {
    title: "Ativar Quant Brain",
    description: "Liga a análise de inteligência e aprendizado do sistema.",
  },
  QB_EDGE_WORKERS: {
    title: "Processadores do Edge",
    description: "Quantidade de tarefas do Edge executadas em paralelo. Valores altos consomem mais CPU.",
  },
  FEATURE_HTTP_CONCURRENCY: {
    title: "Consultas de mercado simultâneas",
    description: "Número máximo de chamadas de dados de mercado executadas ao mesmo tempo.",
  },
  LIVE_WATCHER_POLL_MS: {
    title: "Atualização das posições abertas",
    description: "Intervalo em milissegundos para verificar posições, TP, SL e fechamentos.",
  },
};

const TOKEN_LABELS: Record<string, string> = {
  ALLOW: "Permitir",
  AUTOPILOT: "Piloto automático",
  CANDIDATES: "candidatos",
  COOLDOWN: "intervalo",
  CONCURRENCY: "simultâneos",
  DETECT: "detecção",
  ENABLED: "ativado",
  EXPIRATION: "validade",
  INITIAL: "inicial",
  LEVELS: "níveis",
  LIMIT: "limite",
  LONG: "LONG",
  MAX: "máximo",
  MIN: "mínimo",
  PCT: "%",
  PER: "por",
  SHORT: "SHORT",
  SIDE: "direção",
  TIMEOUT: "tempo limite",
};

function settingPresentation(key: string): { title: string; description: string } {
  const exact = SETTING_META[key];
  if (exact) return exact;

  const nativeSideThreshold = key.match(/^NATIVE_TRIGGER_(LONG|SHORT)_DETECT_PCT_([A-Z0-9]+)$/);
  if (nativeSideThreshold) {
    const [, side, symbol] = nativeSideThreshold;
    return side === "LONG"
      ? {
          title: `Queda necessária para LONG em ${symbol}`,
          description: `Queda percentual específica de ${symbol} que prepara uma entrada LONG.`,
        }
      : {
          title: `Alta necessária para SHORT em ${symbol}`,
          description: `Alta percentual específica de ${symbol} que prepara uma entrada SHORT.`,
        };
  }

  const title = key
    .replace(/^(SCALP|EDGE|NATIVE_TRIGGER|QUANT_BRAIN|QB|DEMO|MASS_ENTRY|KILL_SWITCH|ROLLING|LIVE_READINESS|LIVE_WATCHER)_/, "")
    .split("_")
    .map((token) => TOKEN_LABELS[token] ?? token.toLowerCase())
    .join(" ")
    .replace(/^./, (letter) => letter.toUpperCase());

  return {
    title,
    description: "Configuração operacional avançada. Altere somente se conhecer o impacto no sistema.",
  };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), { credentials: "include", ...init });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(data?.error ?? "Falha na configuracao");
  }
  return response.json() as Promise<T>;
}

async function getRuntimeConfig(): Promise<RuntimeConfig> {
  return requestJson<RuntimeConfig>("/api/bot/config");
}

async function patchRuntimeConfig(patch: Partial<RuntimeConfig>): Promise<RuntimeConfig> {
  return requestJson<RuntimeConfig>("/api/bot/config/override", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

async function getEnvSettings(): Promise<EnvSetting[]> {
  const data = await requestJson<{ settings: EnvSetting[] }>("/api/bot/runtime-env");
  return data.settings;
}

async function patchEnvSetting(key: string, value: string): Promise<EnvSetting[]> {
  const data = await requestJson<{ settings: EnvSetting[] }>("/api/bot/runtime-env", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values: { [key]: value } }),
  });
  return data.settings;
}

export default function ConfigPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: getRuntimeConfig,
    refetchInterval: 10_000,
  });
  const { data: envSettings = [], isLoading: envLoading, error: envError } = useQuery({
    queryKey: ENV_QUERY_KEY,
    queryFn: getEnvSettings,
    refetchInterval: 30_000,
  });

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = envSettings.filter((setting) => {
      if (PRIMARY_ENV_KEYS.has(setting.key)) return false;
      const presentation = settingPresentation(setting.key);
      return !term
        || setting.key.toLowerCase().includes(term)
        || setting.group.toLowerCase().includes(term)
        || presentation.title.toLowerCase().includes(term)
        || presentation.description.toLowerCase().includes(term);
    });
    return Object.entries(
      filtered.reduce<Record<string, EnvSetting[]>>((result, setting) => {
        (result[setting.group] ??= []).push(setting);
        return result;
      }, {}),
    ).sort(([a], [b]) => a.localeCompare(b));
  }, [envSettings, search]);

  async function updateSwitch(
    key: "allowLongEntries" | "allowShortEntries" | "allowExecution",
    enabled: boolean,
  ) {
    if (key === "allowExecution" && enabled && !window.confirm(
      "Ativar execucao permite novas ordens reais quando as travas da cloud estiverem validas. Continuar?",
    )) return;

    try {
      const updated = await patchRuntimeConfig({ [key]: enabled });
      queryClient.setQueryData(CONFIG_QUERY_KEY, updated);
      toast({ title: "Configuracao aplicada", description: "Alteracao ativa e persistida no backend." });
    } catch (error) {
      toast({
        title: "Falha ao aplicar",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    }
  }

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-[1180px]">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Config</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Controles operacionais persistidos diretamente no backend.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-border/40 bg-card/30">
            <CardHeader className="px-5 pt-4 pb-3 border-b border-border/20">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                Direcoes de entrada
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-2">
              <ControlRow
                icon={<ArrowUp className="w-4 h-4 text-emerald-400" />}
                title="Permitir LONG"
                envKey="SCALP_ALLOW_LONG"
                checked={config?.allowLongEntries ?? false}
                disabled={configLoading || !config}
                onChange={(value) => updateSwitch("allowLongEntries", value)}
              />
              <ControlRow
                icon={<ArrowDown className="w-4 h-4 text-rose-400" />}
                title="Permitir SHORT"
                envKey="SCALP_ALLOW_SHORT"
                checked={config?.allowShortEntries ?? false}
                disabled={configLoading || !config}
                onChange={(value) => updateSwitch("allowShortEntries", value)}
              />
            </CardContent>
          </Card>

          <Card className="border-amber-500/25 bg-amber-500/5">
            <CardHeader className="px-5 pt-4 pb-3 border-b border-amber-500/15">
              <CardTitle className="text-sm flex items-center gap-2">
                <Power className="w-4 h-4 text-amber-400" />
                Execucao geral
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <ControlRow
                icon={<ShieldAlert className="w-4 h-4 text-amber-400" />}
                title="Permitir execucao"
                envKey="SCALP_ALLOW_EXECUTION"
                checked={config?.allowExecution ?? false}
                disabled={configLoading || !config}
                onChange={(value) => updateSwitch("allowExecution", value)}
              />
              <p className="text-[10px] mt-3 text-muted-foreground">
                As travas REAL_EXECUTION continuam exclusivas da cloud.
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/40 bg-card/20">
          <CardHeader className="px-5 py-4 border-b border-border/20">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Database className="w-4 h-4 text-primary" />
                Configuracoes avancadas
                <Badge variant="outline" className="text-[9px]">{envSettings.length} campos</Badge>
              </CardTitle>
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por nome, exemplo: cooldown do trigger"
                  className="h-9 pl-8 text-xs"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            {envError && (
              <p className="text-xs text-red-400">
                {envError instanceof Error ? envError.message : "Falha ao carregar configuracoes"}
              </p>
            )}
            {envLoading && <p className="text-xs text-muted-foreground">Carregando configuracoes...</p>}
            {groups.map(([group, settings]) => (
              <section key={group}>
                <div className="flex items-center gap-2 mb-2">
                  <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{group}</h2>
                  <span className="text-[9px] text-muted-foreground">{settings.length}</span>
                </div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {settings.map((setting) => <EnvSettingEditor key={setting.key} setting={setting} />)}
                </div>
              </section>
            ))}
          </CardContent>
        </Card>

        <p className="text-[10px] text-muted-foreground">
          Variaveis PATH/DIR, URLs, tokens, chaves, secrets, credenciais e confirmacoes de dinheiro real nao sao
          expostas. Campos marcados REINICIO ficam persistidos e entram no proximo boot do backend.
        </p>
      </div>
    </AppShell>
  );
}

function EnvSettingEditor({ setting }: { setting: EnvSetting }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(setting.value);
  const [saving, setSaving] = useState(false);
  const dirty = draft !== setting.value;
  const presentation = settingPresentation(setting.key);

  useEffect(() => {
    if (!dirty) setDraft(setting.value);
  }, [setting.value, dirty]);

  async function save(value = draft) {
    setSaving(true);
    try {
      const settings = await patchEnvSetting(setting.key, value);
      queryClient.setQueryData(ENV_QUERY_KEY, settings);
      setDraft(value);
      toast({
        title: setting.requiresRestart ? "Salvo para reinicio" : "Aplicado agora",
        description: setting.key,
      });
    } catch (error) {
      toast({
        title: "Falha ao salvar",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  if (setting.type === "boolean") {
    const checked = draft.toLowerCase() === "true";
    return (
      <div className="flex items-center gap-3 rounded-md border border-border/30 bg-background/20 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold leading-tight">{presentation.title}</p>
          <p className="text-[9px] leading-snug text-muted-foreground mt-1">{presentation.description}</p>
          <p className="truncate font-mono text-[8px] text-muted-foreground/50 mt-1" title={setting.key}>
            {setting.key}
          </p>
          <SettingBadges setting={setting} />
        </div>
        <Switch
          checked={checked}
          disabled={saving}
          onCheckedChange={(value) => {
            const next = String(value);
            setDraft(next);
            void save(next);
          }}
        />
      </div>
    );
  }

  const longValue = setting.key === "SCALP_SYMBOLS" || setting.value.length > 100;
  return (
    <div className="rounded-md border border-border/30 bg-background/20 p-3">
      <p className="text-xs font-semibold leading-tight">{presentation.title}</p>
      <p className="text-[9px] leading-snug text-muted-foreground mt-1 mb-2">{presentation.description}</p>
      {longValue ? (
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="min-h-20 text-[10px] font-mono"
        />
      ) : (
        <Input
          type={setting.type === "number" ? "number" : "text"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="h-8 text-[11px] font-mono"
        />
      )}
      <p className="truncate font-mono text-[8px] text-muted-foreground/50 mt-1.5" title={setting.key}>
        {setting.key}
      </p>
      <div className="flex items-center justify-between gap-2 mt-2">
        <SettingBadges setting={setting} />
        <div className="flex gap-1">
          {dirty && (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDraft(setting.value)}>
              <RotateCcw className="h-3 w-3" />
            </Button>
          )}
          <Button size="sm" className="h-7 px-2 text-[10px]" disabled={!dirty || saving} onClick={() => void save()}>
            <Save className="h-3 w-3 mr-1" />
            Salvar
          </Button>
        </div>
      </div>
    </div>
  );
}

function SettingBadges({ setting }: { setting: EnvSetting }) {
  return (
    <div className="flex items-center gap-1">
      <Badge variant="outline" className={`text-[8px] ${
        setting.requiresRestart ? "text-amber-400 border-amber-500/30" : "text-emerald-400 border-emerald-500/30"
      }`}>
        {setting.requiresRestart ? "REINICIO" : "AGORA"}
      </Badge>
      {setting.overridden && <Badge variant="outline" className="text-[8px]">OVERRIDE</Badge>}
    </div>
  );
}

function ControlRow({
  icon,
  title,
  envKey,
  checked,
  disabled,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  envKey: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/30 bg-background/20 p-3">
      <div className="rounded-md bg-muted/30 p-2">{icon}</div>
      <div className="min-w-0 flex-1">
        <span className="text-sm font-semibold">{title}</span>
        <p className="font-mono text-[9px] text-muted-foreground">{envKey}</p>
      </div>
      <span className={`text-[9px] font-mono font-bold ${checked ? "text-emerald-400" : "text-rose-400"}`}>
        {checked ? "ON" : "OFF"}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
