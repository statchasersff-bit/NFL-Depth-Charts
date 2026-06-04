import { useState, useMemo, useEffect } from "react";
import { 
  useGetAllDepthCharts, 
  useGetTeamDepthChart, 
  getGetTeamDepthChartQueryKey 
} from "@workspace/api-client-react";
import { format } from "date-fns";
import { Search, MapPin, SearchX, Activity, AlertCircle } from "lucide-react";

import { Input } from "@/components/ui/input";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export default function Home() {
  const [selectedTeamAbbr, setSelectedTeamAbbr] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("offense");

  const { data: allDepthCharts, isLoading: isAllLoading } = useGetAllDepthCharts();

  const sortedTeams = useMemo(() => {
    if (!allDepthCharts) return [];
    return [...allDepthCharts].map(dc => dc.team).sort((a, b) => a.name.localeCompare(b.name));
  }, [allDepthCharts]);

  useEffect(() => {
    if (sortedTeams.length > 0 && !selectedTeamAbbr) {
      setSelectedTeamAbbr(sortedTeams[0].abbr);
    }
  }, [sortedTeams, selectedTeamAbbr]);

  const { data: teamDepthChart, isLoading: isTeamLoading, isError } = useGetTeamDepthChart(selectedTeamAbbr, {
    query: {
      enabled: !!selectedTeamAbbr,
      queryKey: getGetTeamDepthChartQueryKey(selectedTeamAbbr)
    }
  });

  const filteredGroups = useMemo(() => {
    if (!teamDepthChart) return { offense: [], defense: [], specialTeams: [] };
    
    const query = searchQuery.toLowerCase().trim();
    if (!query) return teamDepthChart.groups;

    const filterGroup = (groups: any[]) => {
      return groups.map(group => ({
        ...group,
        players: group.players.filter((p: any) => p.name.toLowerCase().includes(query))
      })).filter(group => group.players.length > 0);
    };

    return {
      offense: filterGroup(teamDepthChart.groups.offense),
      defense: filterGroup(teamDepthChart.groups.defense),
      specialTeams: filterGroup(teamDepthChart.groups.specialTeams),
    };
  }, [teamDepthChart, searchQuery]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="bg-white border-b border-border sticky top-0 z-10">
        <div className="container mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold font-display text-lg">
              S
            </div>
            <h1 className="text-xl md:text-2xl font-bold font-display tracking-tight hidden sm:block text-slate-900">
              StatChasers
            </h1>
          </div>
          <div className="text-sm font-medium text-slate-500">
            NFL Team Depth Charts
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 md:px-6 py-8">
        <div className="max-w-6xl mx-auto space-y-8">
          
          <div className="space-y-2">
            <h2 className="text-3xl md:text-4xl font-extrabold font-display text-slate-900">NFL Depth Charts</h2>
            <p className="text-lg text-slate-500">Updated NFL depth charts for all 32 teams.</p>
          </div>

          <div className="bg-white p-4 rounded-xl border border-border shadow-sm flex flex-col md:flex-row gap-4 items-center">
            <div className="w-full md:w-64">
              <Select
                value={selectedTeamAbbr}
                onValueChange={(val) => {
                  setSelectedTeamAbbr(val);
                  setSearchQuery("");
                }}
                disabled={isAllLoading}
              >
                <SelectTrigger className="w-full h-11 text-base font-medium">
                  <SelectValue placeholder="Select Team" />
                </SelectTrigger>
                <SelectContent>
                  {sortedTeams.map((team) => (
                    <SelectItem key={team.abbr} value={team.abbr}>
                      {team.name} ({team.abbr})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full md:flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
              <Input 
                type="text" 
                placeholder="Search player name..." 
                className="w-full pl-10 h-11 text-base"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {isTeamLoading ? (
            <DepthChartSkeleton />
          ) : isError ? (
            <div className="bg-white rounded-xl border border-border p-12 text-center flex flex-col items-center justify-center">
              <AlertCircle className="w-12 h-12 text-slate-300 mb-4" />
              <h3 className="text-xl font-bold text-slate-900">Data Unavailable</h3>
              <p className="text-slate-500 mt-2">There was a problem loading depth chart data. Please try again later.</p>
            </div>
          ) : teamDepthChart ? (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <TabsList className="grid grid-cols-3 w-full sm:w-[400px] h-11 p-1 bg-slate-100 rounded-lg">
                    <TabsTrigger value="offense" className="rounded-md text-sm font-semibold data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm">Offense</TabsTrigger>
                    <TabsTrigger value="defense" className="rounded-md text-sm font-semibold data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm">Defense</TabsTrigger>
                    <TabsTrigger value="specialTeams" className="rounded-md text-sm font-semibold data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm">Special</TabsTrigger>
                  </TabsList>
                  {teamDepthChart.fetchedAt && (
                    <div className="text-sm text-slate-500 flex items-center gap-1.5 font-medium">
                      <Activity className="w-4 h-4 text-primary" />
                      Last updated: {format(new Date(teamDepthChart.fetchedAt), "MMM d, yyyy h:mm a")}
                    </div>
                  )}
                </div>

                <div className="mt-6">
                  <TabsContent value="offense" className="mt-0">
                    <PositionGroupGrid groups={filteredGroups.offense} />
                  </TabsContent>
                  <TabsContent value="defense" className="mt-0">
                    <PositionGroupGrid groups={filteredGroups.defense} />
                  </TabsContent>
                  <TabsContent value="specialTeams" className="mt-0">
                    <PositionGroupGrid groups={filteredGroups.specialTeams} />
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-border p-12 text-center">
              <h3 className="text-xl font-bold text-slate-900">No team selected</h3>
              <p className="text-slate-500 mt-2">Select a team to view their depth chart.</p>
            </div>
          )}

        </div>
      </main>

      <footer className="bg-slate-50 border-t border-border mt-auto">
        <div className="container mx-auto px-4 md:px-6 py-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-slate-500 font-medium">
            © {new Date().getFullYear()} StatChasers. All rights reserved.
          </p>
          <p className="text-sm text-slate-500 font-medium">
            Depth chart data sourced from ESPN.
          </p>
        </div>
      </footer>
    </div>
  );
}

function PositionGroupGrid({ groups }: { groups: any[] }) {
  if (groups.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-16 text-center flex flex-col items-center justify-center">
        <SearchX className="w-12 h-12 text-slate-300 mb-4" />
        <h3 className="text-xl font-bold text-slate-900">No players found</h3>
        <p className="text-slate-500 mt-2">Try adjusting your search query.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {groups.map((group) => (
        <Card key={group.position} className="overflow-hidden border-border/60 shadow-sm hover:shadow-md transition-shadow duration-200">
          <CardHeader className="bg-slate-50/80 border-b border-border/50 py-3 px-4 flex flex-row items-center justify-between">
            <CardTitle className="text-lg font-bold font-display text-slate-900">{group.label}</CardTitle>
            <div className="bg-primary/10 text-primary px-2 py-0.5 rounded font-bold text-xs tracking-wider">
              {group.position}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/50">
              {group.players.map((player: any) => (
                <div key={`${player.rank}-${player.name}`} className="flex items-center gap-3 p-3 hover:bg-slate-50/50 transition-colors">
                  <div className={`
                    w-6 h-6 shrink-0 rounded flex items-center justify-center text-xs font-bold
                    ${player.rank === 1 ? 'bg-primary text-primary-foreground' : 'bg-slate-100 text-slate-500'}
                  `}>
                    {player.rank}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 truncate">
                        {player.name}
                      </span>
                      {player.jersey && (
                        <span className="text-xs font-medium text-slate-400 shrink-0">
                          #{player.jersey}
                        </span>
                      )}
                    </div>
                  </div>

                  {player.status && (
                    <Badge variant="outline" className="text-[10px] uppercase font-bold tracking-wider shrink-0 bg-red-50 text-red-600 border-red-200">
                      {player.status}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DepthChartSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <Skeleton className="h-11 w-full sm:w-[400px] rounded-lg" />
        <Skeleton className="h-5 w-48" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3, 4, 5, 6].map(i => (
          <Card key={i} className="overflow-hidden">
            <CardHeader className="bg-slate-50 py-3 px-4 flex flex-row items-center justify-between">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-5 w-8 rounded" />
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/50">
                {[1, 2, 3].map(j => (
                  <div key={j} className="flex items-center gap-3 p-3">
                    <Skeleton className="w-6 h-6 rounded shrink-0" />
                    <Skeleton className="h-5 flex-1" />
                    <Skeleton className="h-4 w-12 shrink-0" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
