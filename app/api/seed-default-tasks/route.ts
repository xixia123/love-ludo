import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureProfile } from "@/lib/profile";
import fs from "node:fs/promises";
import path from "node:path";

type ThemeTemplate = {
  title: string;
  description?: string;
  type?: string;
  task_count?: number;
  tasks: string[];
};

export async function POST(_req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "未登录或会话失效" }, { status: 401 });
    }
    const userId = userData.user.id;

    // 确保存在昵称档案（首次登陆自动生成）
    try {
      await ensureProfile();
    } catch (e) {
      // 忽略档案初始化失败，不影响题库导入
      console.warn("ensureProfile failed:", e);
    }

    // 读取题库模板
    const filePath = path.join(process.cwd(), "lib", "tasks.json");
    const content = await fs.readFile(filePath, "utf-8");
    const templates: ThemeTemplate[] = JSON.parse(content);

    const themeTitles = templates.map((t) => t.title);
    const { data: existingThemes, error: themesError } = await supabase
      .from("themes")
      .select("id, title, task_count")
      .eq("creator_id", userId)
      .in("title", themeTitles);

    if (themesError) {
      return NextResponse.json({ error: themesError.message }, { status: 500 });
    }

    const existingThemesMap = new Map(existingThemes.map((t) => [t.title, t]));

    const newThemesToCreate = templates.filter((tpl) => !existingThemesMap.has(tpl.title));

    let createdThemes: { id: string; title: string; }[] = [];
    if (newThemesToCreate.length > 0) {
      const { data, error: insertThemesErr } = await supabase
        .from("themes")
        .insert(
          newThemesToCreate.map((tpl) => ({
            title: tpl.title,
            description: tpl.description ?? null,
            creator_id: userId,
            is_public: false,
            task_count: tpl.tasks?.length ?? 0,
          }))
        )
        .select("id, title");

      if (insertThemesErr) {
        return NextResponse.json({ error: insertThemesErr.message }, { status: 500 });
      }
      createdThemes = data;
    }

    const allThemes = [...existingThemes, ...createdThemes.map(t => ({...t, task_count: 0}))];
    const allThemesMap = new Map(allThemes.map((t) => [t.title, t]));

    const tasksToInsert: any[] = [];
    templates.forEach((tpl) => {
      const theme = allThemesMap.get(tpl.title);
      if (theme && (theme.task_count ?? 0) === 0) {
        const rows = (tpl.tasks ?? []).map((desc, idx) => ({
          theme_id: theme.id,
          description: desc,
          type: "interaction",
          order_index: idx,
          is_ai_generated: false,
        }));
        tasksToInsert.push(...rows);
      }
    });

    if (tasksToInsert.length > 0) {
      const { error: insertTasksErr } = await supabase.from("tasks").insert(tasksToInsert);
      if (insertTasksErr) {
        return NextResponse.json({ error: insertTasksErr.message }, { status: 500 });
      }
    }

    // Since we now have accurate task counts from the templates,
    // we don't need to re-query and update the counts.
    // The initial insert of themes already sets the correct task_count.

    const results = templates.map(tpl => {
      const theme = allThemesMap.get(tpl.title);
      return {
        title: tpl.title,
        themeId: theme!.id,
        task_count: tpl.tasks?.length ?? 0,
      }
    });


    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "初始化默认题库失败" }, { status: 500 });
  }
}