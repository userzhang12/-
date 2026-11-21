import json
import os
import re
from datetime import date

import httpx

DURATION = 120
BEAT_COUNT = 12
FORMAT = re.compile(r"国家级|最高级|全网第一|100%\s*有效|根治|药到病除")
PROFILES = [
    ("开场钩子", "特写", "她推开门，桌面上多了一张手写便签。", "动作"),
    ("建立冲突", "中景", "两人因为对同一件小事理解不同而僵住。", "信息差"),
    ("冲突升级", "近景", "她决定先听完对方的解释，把便签翻到背面。", "台词"),
    ("转折铺垫", "过肩", "一个被忽略的细节改变了她的判断。", "视觉"),
    ("商品自然登场", "中景", "她把实际要用的商品摆到桌面，先核对包装。", "动作"),
    ("实拍展示", "特写", "展示已确认的商品素材，镜头停留在真实包装。", "视觉"),
    ("继续行动", "中景", "她和对方一起把事情一步步处理清楚。", "信息差"),
    ("情绪反转", "近景", "她发现原来对方早就准备好了另一份便签。", "情绪"),
    ("细节补充", "特写", "镜头回到商品，展示实拍中的一个细节。", "视觉"),
    ("冲突化解", "双人中景", "两人终于明白了对方的心意。", "情绪"),
    ("可信收束", "中景", "她把真实商品留在画面里，并核对可用信息。", "动作"),
    ("结尾行动", "近景", "她邀请感兴趣的人查看商品页信息。", "台词"),
]
TROPES = [
    ("误会反转", ("家庭", "礼物", "朋友", "日常")),
    ("细节见真章", ("规格", "材质", "包装", "对比")),
    ("职场小插曲", ("职场", "办公室", "便携", "同事")),
]
SHOT_FIELDS = ("title", "size", "description", "dialogue", "prompt", "motion", "hook", "fact_ids", "trend", "events")
NARRATIVE_PROMPT = """
你是微短剧编剧。根据创作要求交付一版从开场到结局的完整故事，包含动作和自然对白。
剧情、人设、冲突和反转可以自由创作，类型建议仅供参考。让商品通过人物的真实行动自然出现。
价格、功效、规格和优惠只能引用已确认商品资料，资料不足就只写日常使用。
尊重用户指定的故事、时长和商品露出要求。此阶段不填写机位、分镜编号或商品资料编号。
只返回 JSON 对象，包含字符串 title 和 story。story 写完整剧本，不写创作说明。
"""
STORY_PROMPT = """
你为竖屏商品微短剧写剧本与可执行分镜。商品资料和热点仅供参考，只能提及已确认的商品事实，不编造价格、优惠或功效。创作要求可指定地域、类型、人物、商品露出时间与表演风格。服从已给剧本和明确创作要求；没有地域设定且受众是中文市场时，选符合剧情的当代中国生活环境。

先定一个与该商品使用场景相扣的冲突，再定人物关系（谁想要什么、谁能阻止、哪件事被误解）。开场第一帧就有角色的可拍动作，另一人立即阻拦、反问或误解，三秒内建立具体对立和观众想追问的事。每镜交付一个新事实、一次决定或一次情绪变化；上一镜的问题由下一镜承接。用此前出现的证据或动作触发反转。商品出现是人物行动的结果，留一个简短真实的使用或展示镜头。未指定时可在中段自然露出。收尾回扣开场，台词短、像人说话，有动作和停顿。

先输出 visual，再输出 12 个各 10 秒的 beats，顺序必须与 shot_slots 完全一致。visual 的 setting 简述时代、地域和画风；style 为 realistic（真人质感）或 stylized（明显动画或插画）。characters 是虚构角色清单，设置可辨识的年龄、发型、面部细节、服装和自然声线。scenes 固定场景的时间、主光源和门窗桌几及人物左右关系。时间、空间或主光源确实变化时，分配新的 scene_id 并交代过渡；同一房间亮灯和停电后应该用两个场景编号。prompt 简写第一帧姿态、视线与道具状态，motion 写动作先后和机位。exit 用一句话交代镜尾可被下一镜接住的人物和道具状态；同场继续上一镜动作，保持门、桌、道具、光线、穿着和机位轴线一致。

product 表示镜序要用真实商品素材出首帧。至少一个镜头为 product=true，画面只展示商品，character_ids 为空，可以有画外音。show_product 表示商品实际可见，和人物同框也为 true。shot_slots 中 product=true 时需输出两个 true；product=false 的镜头两个字段都是 false，画面包括首帧、镜中、结尾都只能表现商品在画外或完全遮挡的状态。product=null 的镜头按剧情安排。speaker_id 标识说话人，dialogue 只放说出口的内容，不在台词里再写名字、画外或表演说明。events 写可拍的镜内变化，开头首个变化必须在 0–2 秒，10 秒内一般有 2–3 个有意义的事件。热梗非必须，最多 2 个且来自输入。

只输出 JSON。以下为键名与类型示例，示例内容不能套进故事；beats 应有 12 项。
{"title":"片名","trope":"叙事方式","visual":{"setting":"时代和地域","style":"realistic","characters":[{"id":"c1","name":"角色名","appearance":"年龄、发型和面部特征","wardrobe":"固定服装","voice":"说话语速与气质"}],"scenes":[{"id":"s1","name":"地点","time":"时间","light":"主光源","layout":"空间和人物位置"}]},"beats":[{"title":"镜头标题","size":"中近景","scene_id":"s1","character_ids":["c1"],"speaker_id":"c1","description":"镜内发生的动作和变化","dialogue":"一句口语台词","prompt":"首帧姿态和道具状态","motion":"动作顺序与镜头走法","exit":"镜尾人物和道具状态","hook":"本镜留下的具体疑问或新事实","product":false,"show_product":false,"fact_ids":[],"trend":"","events":[{"offset":0,"detail":"可拍的变化"}]}]}
"""
REFINE_PROMPT = """
只做一镜定向修订。输出 JSON 对象，只有 beats 数组，数组只含一个对象。可改 title、size、description、dialogue、prompt、motion、hook、fact_ids、trend、events。沿用已有角色外貌、服装、说话人、场景光线、商品安排和交给下一镜的状态。开头动作只能承接 continuity.entry 或 previous 的镜尾，next 是接下来才发生的事情。对白只写说出口的短句，不加姓名或动作旁注。只使用已确认商品事实及其 id。events 包含镜内秒数 offset 与可拍的变化 detail。没提到的可编辑字段保持原值。
JSON 示例：{"beats":[{"description":"接续上一镜的手部动作，抬眼再开口","dialogue":"那我问您一句。","events":[{"offset":0,"detail":"抬眼看向对面"}]}]}
"""


def clean_text(value, label, limit):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
        raise ValueError(f"DeepSeek 返回的{label}缺失或超出长度")
    return value.strip()


def visual_plan(value):
    if not isinstance(value, dict):
        raise ValueError("DeepSeek 未返回人物与场景设定")
    style = value.get("style", "realistic")
    if style not in ("realistic", "stylized"):
        raise ValueError("DeepSeek 返回的画风类型无效")
    result = {"setting": clean_text(value.get("setting"), "故事背景", 140), "style": style}
    for collection, limits in (("characters", {"name": 28, "appearance": 120, "wardrobe": 90, "voice": 65}),
                                ("scenes", {"name": 36, "time": 65, "light": 100, "layout": 150})):
        items = value.get(collection)
        if not isinstance(items, list) or not 1 <= len(items) <= 8:
            raise ValueError("DeepSeek 返回的人物或场景数量无效")
        ids = set()
        result[collection] = []
        for item in items:
            identifier = item.get("id") if isinstance(item, dict) else None
            if not isinstance(identifier, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,20}", identifier) or identifier in ids:
                raise ValueError("DeepSeek 返回的人物或场景编号无效")
            ids.add(identifier)
            result[collection].append({"id": identifier, **{name: clean_text(item.get(name), name, limit) for name, limit in limits.items()}})
    return result


def visual_context(story, beat):
    plan = (story or {}).get("visual")
    if not plan or not beat.get("scene_id"):
        return None
    scene = next((item for item in plan["scenes"] if item["id"] == beat["scene_id"]), None)
    if not scene:
        return None
    characters = [item for item in plan["characters"] if item["id"] in beat.get("character_ids", [])]
    speaker = next((item for item in plan["characters"] if item["id"] == beat.get("speaker_id")), None)
    previous = next((item for item in story["beats"] if item["end"] == beat["start"]), None)
    entry = previous.get("exit", "") if previous and previous.get("scene_id") == beat["scene_id"] else ""
    return {"setting": plan["setting"], "style": plan.get("style", "realistic"), "scene": scene,
            "characters": characters, "speaker": speaker, "entry": entry}


def normalize_dialogue(beat, context):
    speaker = context and context.get("speaker")
    if speaker and isinstance(beat.get("dialogue"), str):
        prefix = re.escape(speaker["name"]) + r"(?:\s*[（(][^）)]{1,12}[）)])?\s*[：:]\s*"
        beat["dialogue"] = re.sub(r"^\s*" + prefix, "", beat["dialogue"]).strip()


def production_prompt(context, beat, *, moving=False):
    detail = beat["motion" if moving else "prompt"]
    if not context:
        return detail
    scene = context["scene"]
    cast = "；".join(f"{person['name']}，{person['appearance']}，穿{person['wardrobe']}" for person in context["characters"])
    sections = [context["setting"], f"{scene['name']}，{scene['time']}，{scene['light']}。空间关系：{scene['layout']}",
                f"本镜出场：{cast}" if cast else "本镜无人入画", f"景别：{beat['size']}"]
    if context["entry"] and not beat.get("product"):
        sections.append(f"承接上一镜状态：{context['entry']}")
    if beat.get("show_product") is False:
        sections.append("本镜中商品和可辨包装保持在画外或完全遮挡")
    sections.append(detail)
    if moving and beat.get("events"):
        actions = "；".join(f"第{event['offset']}秒 {event['detail']}" for event in sorted(beat["events"], key=lambda item: item["offset"]))
        sections.append(f"镜内节奏：{actions}")
    if moving and beat.get("exit"):
        sections.append(f"结束姿态和道具位置：{beat['exit']}")
    return "。\n".join(sections)


def select_tropes(document):
    text = document["audience"] + " " + " ".join(f["value"] for f in document["facts"] if f["confirmed"])
    return sorted(TROPES, key=lambda item: -sum(word in text for word in item[1]))


def eligible_trends(pool, document):
    today = date.today().isoformat()
    context = document["audience"] + " " + document["name"]
    return sorted((item for item in pool if item["expires"] >= today),
                  key=lambda item: (any(tag in context for tag in item["tags"]), item["date"]), reverse=True)[:5]


class StoryboardError(ValueError):
    def __init__(self, message, narrative):
        super().__init__(message)
        self.narrative = narrative


def draft(document, pool, focus=None, notes="", narrative=None):
    progress = dict(narrative or {})
    try:
        return draft_shots(document, pool, focus, notes, progress)
    except (ValueError, httpx.HTTPError) as error:
        if progress:
            detail = str(error) if isinstance(error, ValueError) else "DeepSeek 分镜请求失败"
            raise StoryboardError(detail, progress) from error
        raise


def draft_shots(document, pool, focus, notes, progress):
    sources = [f for f in document["facts"] if f["confirmed"]]
    tropes = select_tropes(document)
    current = next((b for b in (document.get("script") or {}).get("beats", []) if b["id"] == focus), None)
    trends = eligible_trends(pool, document)
    key = os.getenv("DEEPSEEK_API_KEY")
    receipt = {}
    visual = None
    product_start = document.get("product_start")
    if key:
        model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
        def request_json(instruction, data, max_tokens):
            parameters = {"model": model, "messages": [
                {"role": "system", "content": instruction},
                {"role": "user", "content": json.dumps(data, ensure_ascii=False)},
            ], "response_format": {"type": "json_object"}, "max_tokens": max_tokens}
            if model in {"deepseek-flash", "deepseek-v4-pro"}:
                parameters["thinking"] = {"type": "disabled"}
            response = httpx.post(os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/") + "/chat/completions",
                                  headers={"Authorization": f"Bearer {key}"}, json=parameters, timeout=90)
            response.raise_for_status()
            return response

        request = {"project": document["name"], "facts": sources, "audience": document["audience"],
                   "direction": document.get("direction", ""), "tropes": [item[0] for item in tropes], "trends": trends}
        system = STORY_PROMPT
        if current:
            system = REFINE_PROMPT
            shots = document["script"]["beats"]
            index = shots.index(current)
            visible_fields = (*SHOT_FIELDS, "id", "scene_id", "character_ids", "speaker_id", "exit", "product", "show_product", "start", "end")
            request.update(visual=document["script"].get("visual"), notes=notes,
                           current={field: current[field] for field in visible_fields if field in current},
                           continuity=visual_context(document["script"], current))
            for name, position in (("previous", index - 1), ("next", index + 1)):
                if 0 <= position < len(shots):
                    request[name] = {field: shots[position][field] for field in visible_fields if field in shots[position]}
        else:
            if not progress:
                narrative_reply = request_json(NARRATIVE_PROMPT, {**request, "duration": DURATION, "product_start": product_start}, 2200).json()
                try:
                    choice = narrative_reply["choices"][0]
                    if choice.get("finish_reason") == "length":
                        raise ValueError("DeepSeek 故事输出达到长度限制")
                    narrative = json.loads(choice["message"]["content"])
                    progress.update(title=clean_text(narrative.get("title"), "片名", 150),
                                    story=clean_text(narrative.get("story"), "故事正文", 6000))
                except (AttributeError, KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
                    raise ValueError("DeepSeek 没有返回可读的故事草稿") from error
            request["narrative"] = progress
            system += "\n将输入 narrative 拆成制作分镜，保留原故事的人物、冲突、反转与结局。"
            request["shot_slots"] = [{"id": f"{index + 1:02}", "start": start, "end": start + 10,
                                      "product": start == product_start if product_start is not None and start <= product_start else None}
                                     for index, start in enumerate(range(0, DURATION, 10))]
        response = request_json(system, request, 2200 if current else 7600)
        reply = response.json()
        try:
            choice = reply["choices"][0]
            if choice.get("finish_reason") == "length":
                raise ValueError("DeepSeek 输出达到长度限制，未替换原剧本")
            generated = json.loads(choice["message"]["content"] or "{}")
        except (IndexError, KeyError, TypeError, json.JSONDecodeError) as error:
            raise ValueError("DeepSeek 没有返回可读的剧本 JSON，原剧本仍可使用") from error
        receipt = {"provider": {"model": reply.get("model") or model,
                                "request_id": reply.get("id") or response.headers.get("x-request-id"),
                                "tokens": (reply.get("usage") or {}).get("total_tokens")}}
        values = generated.get("beats") if isinstance(generated, dict) else None
        if not isinstance(values, list) or len(values) != (1 if current else BEAT_COUNT) or not all(isinstance(item, dict) for item in values):
            raise ValueError("供应商返回的分镜数量不符合要求")
        if not current:
            visual = visual_plan(generated.get("visual"))
    else:
        generated = {"title": document["name"], "trope": tropes[0][0], "beats": [{} for _ in PROFILES]}
    if current:
        replacement = dict(current)
        if not key:
            replacement["description"] = f"{current['description']} {notes}"[:2000]
        else:
            replacement.update({field: value for field, value in generated["beats"][0].items()
                                if field in SHOT_FIELDS})
            if "size" in generated["beats"][0]:
                replacement["size"] = clean_text(replacement["size"], "景别", 24)
        normalize_dialogue(replacement, visual_context(document["script"], replacement))
        replacement.update(revision=current["revision"] + 1, approved=False)
        for field in ("frame", "clip", "caption", "clip_reviewed", "clip_dynamic", "frame_trusted_until"):
            replacement.pop(field, None)
        if replacement["trend"] != current["trend"] and replacement["trend"] and replacement["trend"] not in {item["text"] for item in trends}:
            raise ValueError("修订使用了不在授权范围内的热梗")
        validate_script([replacement if b["id"] == focus else b for b in document["script"]["beats"]], sources)
        return {"beat": replacement, **receipt}

    beats = []
    product_asset = next((item["id"] for item in reversed(document["assets"]) if item["kind"] == "product"), None)
    cast_ids = {person["id"] for person in visual["characters"]} if visual else set()
    scene_ids = {scene["id"] for scene in visual["scenes"]} if visual else set()
    demo_products = {4, 5, 8, 10}
    if product_start is not None:
        demo_products = {index for index in demo_products if index * 10 > product_start} | {product_start // 10}
    for i, ((title, size, description, hook), values) in enumerate(zip(PROFILES, generated["beats"])):
        product = values.get("product") if visual else i in demo_products
        default_ids = [sources[0]["id"]] if sources and product else []
        beat = {
            "id": f"{i + 1:02}", "start": 10 * i, "end": 10 * (i + 1), "size": size, "title": title,
            "description": description, "dialogue": "先等等，这张便签是谁留下的？" if i == 0 else "",
            "prompt": f"写实竖屏短剧，温暖室内自然光，{size}。{description}", "motion": "缓慢推进，保持构图和主体一致。",
            "hook": hook, "fact_ids": default_ids, "trend": "", "product": product,
            "events": [{"offset": 0, "detail": description}],
            "asset_ids": [product_asset] if product and product_asset else [],
            "dynamic": i in {0, 3, 7}, "revision": 1, "approved": False,
        }
        if visual:
            exposure = values.get("show_product")
            if type(product) is not bool or type(exposure) is not bool or not all(field in values for field in SHOT_FIELDS):
                raise ValueError(f"第 {i + 1} 镜缺少可执行分镜信息")
            scene = values.get("scene_id")
            characters = values.get("character_ids")
            speaker = values.get("speaker_id", "")
            if not isinstance(scene, str) or scene not in scene_ids:
                raise ValueError(f"第 {i + 1} 镜引用了未定义的场景")
            if (not isinstance(characters, list) or not all(isinstance(role, str) and role in cast_ids for role in characters)
                    or len(characters) != len(set(characters)) or not isinstance(speaker, str)
                    or (speaker and speaker not in cast_ids)):
                raise ValueError(f"第 {i + 1} 镜引用了无效的人物或说话者")
            if product and characters:
                beat.update(product=False, asset_ids=[])
            beat.update({field: values[field] for field in SHOT_FIELDS})
            for field, limit in (("title", 80), ("size", 24), ("description", 240), ("prompt", 265), ("motion", 320), ("hook", 110)):
                beat[field] = clean_text(beat[field], field, limit)
            beat.update(scene_id=scene, character_ids=characters, speaker_id=speaker, show_product=product or exposure,
                        exit=clean_text(values.get("exit"), "镜尾状态", 160),
                        frame_subject="character" if characters and visual["style"] == "realistic" else "")
        beats.append(beat)
    if visual:
        story = {"visual": visual, "beats": beats}
        for beat in beats:
            normalize_dialogue(beat, visual_context(story, beat))
    validate_script(beats, sources, trends)
    if visual:
        first_product = next((beat["start"] for beat in beats if beat["product"]), None)
        if first_product is None:
            raise ValueError("DeepSeek 没有安排真实商品镜头")
        first_visible = next((beat["start"] for beat in beats if beat["show_product"]), None)
        if product_start is not None and (first_product != product_start or first_visible != product_start):
            raise ValueError(f"DeepSeek 没有在 {product_start}–{product_start + 10} 秒安排首个商品专镜")
        if not any(event["offset"] <= 2 for event in beats[0]["events"]):
            raise ValueError("首镜前三秒缺少可执行的开场动作")
    return {"title": str(generated.get("title", document["name"]))[:150], "trope": str(generated.get("trope", tropes[0][0]))[:60],
            "beats": beats, **({"visual": visual} if visual else {}),
            **({"narrative": progress} if progress else {}), **receipt}


def validate_script(beats, facts, trends=None):
    eligible = {f["id"] for f in facts if f["confirmed"]}
    selected = {b["trend"] for b in beats if isinstance(b["trend"], str) and b["trend"]}
    if len(selected) > 2 or (trends is not None and not selected <= {item["text"] for item in trends}):
        raise ValueError("热梗超出授权范围或超过两个")
    next_start = 0
    for beat in beats:
        if beat["start"] != next_start or beat["end"] <= next_start:
            raise ValueError("分镜时间线存在间隙或重叠")
        next_start = beat["end"]
        if not all(isinstance(beat[key], str) and len(beat[key]) <= 2000
                   for key in ("title", "description", "dialogue", "prompt", "motion", "hook", "trend")):
            raise ValueError("分镜文字字段无效")
        if not isinstance(beat["fact_ids"], list) or not all(isinstance(f, str) and f in eligible for f in beat["fact_ids"]):
            raise ValueError("分镜引用了未经确认的商品事实")
        events = beat.get("events", [])
        if not isinstance(events, list) or len(events) > 10 or any(
            not isinstance(event, dict) or type(event.get("offset")) is not int or
            not 0 <= event["offset"] < beat["end"] - beat["start"] or
            not isinstance(event.get("detail"), str) or not event["detail"].strip() or len(event["detail"]) > 200
            for event in events
        ):
            raise ValueError("节拍事件的时间或内容无效")
        visible = " ".join(beat[key] for key in ("dialogue", "title", "description", "prompt"))
        if FORMAT.search(visible):
            raise ValueError("发现需要人工复核的宣传用语")
        if len(beat["dialogue"]) > (beat["end"] - beat["start"]) * 7:
            raise ValueError("台词过长，请缩短后重试")
    if next_start != DURATION:
        raise ValueError("成片时间线必须为 120 秒")


def pacing_issues(beats):
    anchors = set()
    for beat in beats:
        for event in beat.get("events", []):
            if isinstance(event, dict) and type(event.get("offset")) is int and isinstance(event.get("detail"), str):
                offset = event["offset"]
                if 0 <= offset < beat["end"] - beat["start"] and event["detail"].strip():
                    anchors.add((beat["start"] + offset) // 3)
    return [{"start": start, "end": min(start + 3, DURATION)}
            for start in range(0, DURATION, 3) if start // 3 not in anchors]
